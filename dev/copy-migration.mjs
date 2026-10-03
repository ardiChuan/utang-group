// Salin schema.sql TANPA baris set PIN ke clipboard, untuk update Supabase asli
// tanpa me-reset PIN grup. Jalankan: npm run sql:copy
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const cut = schema.indexOf('-- SET PIN GRUP');
if (cut < 0) throw new Error('Penanda "-- SET PIN GRUP" tidak ditemukan di schema.sql');
// Mundur ke awal blok komentar "=====" di atas penanda.
const start = schema.lastIndexOf('-- =====', cut);
const sql = schema.slice(0, start).trimEnd() + '\n';

const tmp = path.join(os.tmpdir(), 'utang-migration.sql');
fs.writeFileSync(tmp, sql, 'utf8');
try {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Get-Content -Raw -Encoding UTF8 '${tmp}' | Set-Clipboard`]);
  } else if (process.platform === 'darwin') {
    execFileSync('pbcopy', { input: sql });
  } else {
    execFileSync('xclip', ['-selection', 'clipboard'], { input: sql });
  }
  console.log(`Disalin ke clipboard (${sql.length} karakter, tanpa set PIN).`);
  console.log('Paste di Supabase > SQL Editor > New query > Run. PIN grup tidak berubah.');
} finally {
  fs.rmSync(tmp, { force: true });
}
