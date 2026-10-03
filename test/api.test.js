const test = require('node:test');
const assert = require('node:assert');
const handler = require('../api/scan.js');

const mkRes = () => {
  const r = { status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
};
const okBody = (data) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] });
const post = async (body) => { const r = mkRes(); await handler({ method: 'POST', body }, r); return r; };

function mockFetch({ pinOk = true, gemini = [] } = {}) {
  const calls = [];
  global.fetch = async (url, opt) => {
    calls.push({ url, opt });
    if (url.includes('check_pin')) {
      return pinOk ? { ok: true, text: async () => 'true' } : { ok: false, text: async () => '{"message":"PIN_SALAH"}' };
    }
    const next = gemini.shift();
    if (next && next.status) return { ok: false, status: next.status, json: async () => ({ error: { message: 'x' } }) };
    return { ok: true, status: 200, json: async () => okBody(next) };
  };
  return calls;
}

test.beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_x';
  process.env.GEMINI_API_KEY = 'g';
});

test('PIN salah: 401 dan Gemini tidak dipanggil', async () => {
  const calls = mockFetch({ pinOk: false });
  const r = await post({ pin: 'bad', image: 'QUJD' });
  assert.strictEqual(r.code, 401);
  assert.ok(!calls.some((c) => c.url.includes('googleapis')));
});

test('normalisasi hasil Gemini', async () => {
  mockFetch({ gemini: [{ merchant: 'Sate', date: '01/10', items: [{ name: 'Nasi', price: 30000 }, { name: 'X', price: 0 }, { name: 'Ayam', qty: 2, price: 60000.4 }], tax: 10000, total: 0 }] });
  const r = await post({ pin: 'ok', image: 'QUJD' });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.items.length, 2);
  assert.strictEqual(r.body.total, 100000);
  assert.strictEqual(r.body.date, '');
});

test('retry lalu fallback model saat 503', async () => {
  const calls = mockFetch({ gemini: [{ status: 503 }, { status: 503 }, { merchant: 'A', items: [{ name: 'x', price: 1000 }], total: 1000 }] });
  const r = await post({ pin: 'ok', image: 'QUJD' });
  assert.strictEqual(r.code, 200);
  const models = calls.filter((c) => c.url.includes('googleapis')).map((c) => c.url.split('/models/')[1].split(':')[0]);
  assert.deepStrictEqual(models, ['gemini-flash-latest', 'gemini-flash-latest', 'gemini-flash-lite-latest']);
});

test('header auth: Bearer hanya untuk key JWT lama', async () => {
  let calls = mockFetch({ pinOk: false });
  process.env.SUPABASE_ANON_KEY = 'eyJabc';
  await post({ pin: 'x', image: 'A' });
  assert.strictEqual(calls[0].opt.headers.Authorization, 'Bearer eyJabc');
  calls = mockFetch({ pinOk: false });
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_x';
  await post({ pin: 'x', image: 'A' });
  assert.strictEqual(calls[0].opt.headers.Authorization, undefined);
});
