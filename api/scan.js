// Vercel function: POST /api/scan  { pin, image (base64 JPEG) }
// Cek PIN grup via Supabase, lalu minta Gemini membaca struk jadi JSON.
// Env (Vercel > Settings > Environment Variables):
//   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_MODEL (opsional)

const PROMPT = `Kamu membaca foto struk belanja/restoran (biasanya Indonesia, mata uang Rupiah).
Kembalikan JSON sesuai schema.
Aturan:
- Semua angka dalam rupiah bulat. "45.000" atau "45,000" = 45000. Jangan pakai desimal.
- items: hanya baris barang/menu. price = total baris (qty x harga satuan) SEBELUM pajak/service.
  Jangan masukkan subtotal, pajak (PB1/PPN/tax), service charge, diskon, total, tunai, kembalian ke items.
- Kalau ada diskon per item, kurangi dari price item itu.
- tax, service, discount: total masing-masing (0 kalau tidak ada). discount bernilai positif.
- total: total akhir yang harus dibayar.
- merchant: nama toko/restoran singkat. date: format YYYY-MM-DD, kosong kalau tidak terbaca.
- Kalau gambar bukan struk, kembalikan items kosong dan total 0.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: { type: 'STRING' },
    date: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          qty: { type: 'INTEGER' },
          price: { type: 'INTEGER' },
        },
        required: ['name', 'price'],
      },
    },
    tax: { type: 'INTEGER' },
    service: { type: 'INTEGER' },
    discount: { type: 'INTEGER' },
    total: { type: 'INTEGER' },
  },
  required: ['merchant', 'items', 'total'],
};

async function checkPin(pin) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw Object.assign(new Error('Server belum dikonfigurasi (SUPABASE_URL/SUPABASE_ANON_KEY).'), { status: 500 });
  const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/check_pin', {
    method: 'POST',
    // Key lama (JWT eyJ...) butuh Bearer juga; key baru sb_publishable_ cukup apikey.
    headers: Object.assign({ apikey: key, 'Content-Type': 'application/json' },
      key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}),
    body: JSON.stringify({ p_pin: String(pin || '') }),
  });
  if (r.ok) return;
  const body = await r.text();
  if (/PIN_SALAH|PIN_BELUM_DISET/.test(body)) throw Object.assign(new Error('PIN_SALAH'), { status: 401 });
  throw Object.assign(new Error('Gagal cek PIN: ' + body.slice(0, 200)), { status: 502 });
}

async function readReceipt(imageB64) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('Server belum dikonfigurasi (GEMINI_API_KEY).'), { status: 500 });
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: imageB64 } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (body.error && body.error.message) || 'HTTP ' + r.status;
    const status = r.status === 429 ? 429 : 502;
    throw Object.assign(new Error(status === 429 ? 'Kuota Gemini habis, coba lagi nanti.' : 'Gemini error: ' + msg), { status });
  }
  const text = (((body.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
  let data;
  try { data = JSON.parse(text); } catch (_) { throw Object.assign(new Error('Struk tidak terbaca, coba foto ulang.'), { status: 422 }); }
  return normalize(data);
}

function int(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalize(d) {
  const items = (Array.isArray(d.items) ? d.items : [])
    .map((it) => ({ name: String(it.name || '').trim().slice(0, 60) || 'Item', qty: int(it.qty) || 1, price: int(it.price) }))
    .filter((it) => it.price > 0)
    .slice(0, 60);
  const itemsSum = items.reduce((a, it) => a + it.price, 0);
  let total = int(d.total);
  if (!total) total = itemsSum + int(d.tax) + int(d.service) - int(d.discount);
  return {
    merchant: String(d.merchant || '').trim().slice(0, 60),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : '',
    items,
    tax: int(d.tax),
    service: int(d.service),
    discount: int(d.discount),
    total: Math.max(total, 0),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const image = String(body.image || '');
    if (!image || image.length > 4_000_000) return res.status(400).json({ error: 'Gambar kosong atau terlalu besar.' });
    await checkPin(body.pin);
    const result = await readReceipt(image);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Gagal' });
  }
};
module.exports.normalize = normalize;
