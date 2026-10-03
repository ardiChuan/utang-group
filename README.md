# Utang Grup

Web app untuk mencatat utang-piutang 1 grup kecil (≈6 orang). Dibuat untuk dipakai di iPhone (Safari).
Hosting gratis: **Vercel** (website statis) + **Supabase** (database).

Fitur:
- **Split bill**: satu orang bayar, dibagi rata atau custom ke beberapa orang
- **Utang langsung**: "B utang ke A Rp50.000"
- **Bayar utang / Tandai lunas**: pelunasan, termasuk dari saran transfer
- **Simplify**: saran transfer paling sedikit supaya semua lunas
- **Riwayat** semua transaksi, bisa diedit/dihapus, plus **log aktivitas** (siapa ubah apa)
- **Foto nota**: otomatis tersimpan dari scan struk, atau dilampirkan manual. Lihat dari detail transaksi (ikon 📎)
- Login: **PIN grup** + pilih nama. Anggota diatur dari dalam app.

## 1. Setup Supabase

1. Buat project baru di https://supabase.com/dashboard (region terdekat: Singapore).
2. Buka **SQL Editor → New query**, lalu paste seluruh isi `schema.sql`.
3. **Sebelum Run**, ganti `'GANTI-PIN-INI'` di baris paling bawah dengan PIN grup kamu,
   **langsung di SQL Editor**. Jangan edit `schema.sql` di folder project, supaya PIN asli tidak masuk git.
   Minimal 6 karakter, lebih panjang lebih aman. Kalau placeholder lupa diganti, login otomatis ditolak.
4. Klik **Run**. Hasilnya harus "Success".
5. Buka **Project Settings → API Keys** (atau tombol **Connect**), lalu salin:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon / publishable key**

> ⚠️ Jangan pernah pakai **service_role / secret key** di website. Key itu bisa baca/hapus semua data.
> Anon key boleh publik karena semua tabel terkunci (RLS) dan data hanya bisa diakses lewat fungsi yang mengecek PIN.

## 2. Isi config

Edit `config.js`:

```js
window.UTANG_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...atau sb_publishable_...',
};
```

## 3. Deploy ke Vercel

**Cara A: lewat GitHub (disarankan, update otomatis tiap push)**
1. Buat repo **private** baru di GitHub, lalu push folder ini.
2. Di https://vercel.com/new, import repo tersebut.
3. Framework Preset: **Other**. Build Command & Output Directory **kosongkan**.
4. Deploy. Selesai, dapat link `https://nama-project.vercel.app`.
5. Cek `https://nama-project.vercel.app/schema.sql`. Harus **404** (diatur oleh `.vercelignore`).

**Cara B: tanpa GitHub**
```bash
npx vercel        # login, ikuti prompt, terima default
npx vercel --prod
```

## 3b. Scan struk (Gemini, gratis)

1. Buat API key di https://aistudio.google.com/apikey (gratis, login akun Google).
2. Di Vercel → project → **Settings → Environment Variables**, tambahkan:
   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | key dari AI Studio |
   | `SUPABASE_URL` | sama dengan di `config.js` |
   | `SUPABASE_ANON_KEY` | sama dengan di `config.js` |
   | `GEMINI_MODEL` | opsional, default `gemini-flash-latest` |
3. **Redeploy** (Deployments → titik tiga → Redeploy) supaya env terbaca.

Cara pakai: Tambah → Split bill → **Scan struk** → foto struk → tap nama orang di tiap item → **Pakai pembagian ini** → cek "Dibayar oleh" → Simpan.
Pajak/service/diskon (selisih antara total dan jumlah item) dibagi proporsional.

Catatan:
- Server mengecek PIN grup dulu sebelum memanggil Gemini, jadi orang luar tidak bisa memakai kuota kamu.
- Foto struk dikirim ke Google. Data free tier Gemini bisa dipakai Google untuk melatih model.
- Scan **tidak jalan** di server lokal / mode demo (butuh Vercel function).

## 4. Pakai di iPhone

1. Buka link Vercel di **Safari**.
2. Masukkan PIN grup.
3. Orang pertama mengetik namanya, lalu menambah anggota lain di tab **Anggota**.
4. Opsional: tombol Share → **Add to Home Screen** supaya muncul seperti app.
   Penyimpanan app Home Screen terpisah dari Safari, jadi PIN perlu dimasukkan sekali lagi. Ini normal.
5. Kirim link + PIN ke grup. Tiap orang pilih namanya sendiri.

## Development lokal

Butuh Node.js 20+. Sekali saja: `npm install`.

| Perintah | Isi |
|---|---|
| `npm run dev` | Server lokal + **database lokal** (`.localdb/`), PIN `local123`. Aman, tidak menyentuh data grup. |
| `npm run dev:mock` | Sama, tapi scan struk pakai data palsu (tanpa Gemini, tanpa kuota). |
| `npm run dev:reset` | Hapus database lokal, mulai dari kosong. |
| `npm run dev:prod` | Server lokal tapi pakai **Supabase asli**. Hati-hati, ini data grup beneran. |
| `npm test` | Tes otomatis: logika saldo/split, SQL + keamanan, API scan. |
| `npm run sql:copy` | Salin `schema.sql` **tanpa baris set PIN** ke clipboard. Dipakai untuk update database Supabase asli setelah schema berubah (PIN grup tidak ter-reset). |

- Buka `http://localhost:3000`. Dari iPhone (Wi-Fi sama): `http://IP-LAPTOP:3000` (alamat muncul saat server start).
- Scan struk dengan Gemini asli secara lokal: salin `.env.example` jadi `.env.local`, isi `GEMINI_API_KEY`.
- Mode lokal ditandai badge **LOKAL** di atas, supaya tidak tertukar dengan versi production.
- `.env.local`, `.localdb/`, `dev/`, `test/` tidak ikut ke Vercel.

## Catatan penting

- **Supabase free tier mem-pause project** kalau tidak dipakai sekitar 1 minggu.
  Kalau web muncul "Gagal konek… project Supabase sedang pause", buka dashboard Supabase lalu klik **Restore/Resume**. Data tidak hilang.
- **Ganti PIN**: di app (tab Anggota → Ganti PIN grup), atau jalankan ulang baris `insert into public.settings ...` di SQL Editor dengan PIN baru (bisa dipakai kalau lupa PIN).
- **Hati-hati**: menjalankan ulang seluruh `schema.sql` aman untuk data, tapi **mereset PIN** ke nilai di baris terakhir.
- Hapus transaksi = soft delete. Datanya tetap ada di database dan tercatat di log aktivitas.
- Anggota tidak bisa dihapus, hanya dinonaktifkan, dan hanya kalau saldonya sudah nol.

## Struktur

| File | Isi |
|---|---|
| `index.html` | Halaman utama |
| `app.js` | UI dan pemanggilan Supabase |
| `logic.js` | Hitung saldo, bagi rata, simplify |
| `styles.css` | Tampilan (mobile-first, dark mode otomatis) |
| `config.js` | URL + anon key Supabase |
| `schema.sql` | Tabel, keamanan, fungsi RPC |
| `api/scan.js` | Vercel function: cek PIN → Gemini baca struk |
| `demo.js` | Mode demo lokal (localStorage) kalau config belum diisi |

Cara kerja saldo: untuk tiap transaksi, `payer += amount` dan tiap `share.member -= share.amount`.
Saldo positif berarti orang lain utang ke dia, negatif berarti dia yang utang.
