# Utang Grup

Web app untuk mencatat utang-piutang 1 grup kecil (≈6 orang). Dibuat untuk dipakai di iPhone (Safari).
Hosting gratis: **Vercel** (website statis) + **Supabase** (database).

Fitur:
- **Split bill**: satu orang bayar, dibagi rata atau custom ke beberapa orang
- **Utang langsung**: "B utang ke A Rp50.000"
- **Bayar utang / Tandai lunas**: pelunasan, termasuk dari saran transfer
- **Simplify**: saran transfer paling sedikit supaya semua lunas
- **Riwayat** semua transaksi, bisa diedit/dihapus, plus **log aktivitas** (siapa ubah apa)
- Login: **PIN grup** + pilih nama. Anggota diatur dari dalam app.

## 1. Setup Supabase

1. Buat project baru di https://supabase.com/dashboard (region terdekat: Singapore).
2. Buka **SQL Editor → New query**, lalu paste seluruh isi `schema.sql`.
3. **Sebelum Run**, ganti `'GANTI-PIN-INI'` di baris paling bawah dengan PIN grup kamu.
   Minimal 6 karakter. Lebih panjang lebih aman, misalnya `kopi-senja-2026`.
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

**Cara B: tanpa GitHub**
```bash
npx vercel        # login, ikuti prompt, terima default
npx vercel --prod
```

## 4. Pakai di iPhone

1. Buka link Vercel di **Safari**.
2. Masukkan PIN grup.
3. Orang pertama mengetik namanya, lalu menambah anggota lain di tab **Anggota**.
4. Opsional: tombol Share → **Add to Home Screen** supaya muncul seperti app.
5. Kirim link + PIN ke grup. Tiap orang pilih namanya sendiri.

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

Cara kerja saldo: untuk tiap transaksi, `payer += amount` dan tiap `share.member -= share.amount`.
Saldo positif berarti orang lain utang ke dia, negatif berarti dia yang utang.
