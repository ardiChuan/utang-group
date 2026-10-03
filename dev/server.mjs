// Local dev server: static files + emulator Supabase RPC (PGlite) + /api/scan.
//   npm run dev        -> database lokal (.localdb/), aman untuk coba-coba
//   npm run dev:mock   -> sama, tapi scan struk pakai data palsu (tanpa Gemini)
//   npm run dev:reset  -> hapus database lokal lalu mulai dari kosong
//   npm run dev:prod   -> pakai Supabase asli dari config.js (data grup beneran!)
// Env bisa ditaruh di .env.local (lihat .env.example).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---------- .env.local ----------
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const argv = process.argv.slice(2);
if (argv.includes('--mock')) process.env.SCAN_MOCK = '1';
if (argv.includes('--reset')) process.env.RESET_DB = '1';
if (argv.includes('--supabase')) process.env.DB = 'supabase';

const PORT = Number(process.env.PORT) || 3000;
const MODE = (process.env.DB || 'local').toLowerCase();
const LOCAL_PIN = process.env.LOCAL_PIN || 'local123';
const LOCAL_KEY = 'local-dev-key';

// ---------- Database lokal ----------
let db = null;
if (MODE === 'local') {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  if (process.env.RESET_DB === '1') fs.rmSync(path.join(ROOT, '.localdb'), { recursive: true, force: true });
  db = new PGlite(path.join(ROOT, '.localdb'), { extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists extensions;
    do $$ begin
      if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;`);
  const schema = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
  const placeholder = "values (1, extensions.crypt('GANTI-PIN-INI'";
  if (!schema.includes(placeholder)) throw new Error('Baris set PIN di schema.sql tidak ditemukan');
  await db.exec(schema.replace(placeholder, `values (1, extensions.crypt('${LOCAL_PIN.replace(/'/g, "''")}'`));
  await db.exec('set role anon'); // semua query berikutnya pakai hak akses anon, sama seperti Supabase
  process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.SUPABASE_ANON_KEY = LOCAL_KEY;
} else {
  const cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  process.env.SUPABASE_URL ||= (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1];
  process.env.SUPABASE_ANON_KEY ||= (cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
}

async function rpc(fn, args) {
  if (!/^[a-z_]+$/.test(fn)) return [404, { message: 'Could not find the function ' + fn }];
  const keys = Object.keys(args || {});
  if (keys.some((k) => !/^p_[a-z_]+$/.test(k))) return [400, { message: 'Bad argument name' }];
  const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  try {
    const res = await db.query(sql, vals);
    return [200, res.rows[0].r ?? null];
  } catch (e) {
    if (/does not exist/.test(e.message) && /function/.test(e.message)) return [404, { message: 'Could not find the function public.' + fn }];
    if (/permission denied/.test(e.message)) return [401, { code: '42501', message: e.message }];
    return [400, { code: e.code, message: e.message, details: null, hint: null }];
  }
}

// ---------- /api/scan ----------
const MOCK_RECEIPT = {
  merchant: 'Warung Mock (SCAN_MOCK)',
  date: new Date().toLocaleDateString('en-CA'),
  items: [
    { name: 'Nasi Goreng', qty: 2, price: 50000 },
    { name: 'Mie Ayam', qty: 1, price: 22000 },
    { name: 'Es Jeruk', qty: 3, price: 24000 },
  ],
  tax: 9600, service: 0, discount: 0, total: 105600,
};

async function scan(req, res, body) {
  if (process.env.SCAN_MOCK === '1') {
    if (MODE === 'local') {
      const [code] = await rpc('check_pin', { p_pin: String(body.pin || '') });
      if (code !== 200) return send(res, 401, { error: 'PIN_SALAH' });
    }
    await new Promise((r) => setTimeout(r, 800));
    return send(res, 200, MOCK_RECEIPT);
  }
  const handler = require(path.join(ROOT, 'api', 'scan.js'));
  const shim = {
    status(c) { shim.code = c; return shim; },
    json(b) { send(res, shim.code || 200, b); return shim; },
  };
  await handler({ method: req.method, body }, shim);
}

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const PRIVATE = /^\/(\.|dev\/|test\/|node_modules\/|schema\.sql|README\.md|package)/;

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 6e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'POST' && p.startsWith('/rest/v1/rpc/')) {
      if (!db) return send(res, 404, { message: 'RPC lokal hanya di DB=local' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const [code, data] = await rpc(p.slice('/rest/v1/rpc/'.length), body);
      return send(res, code, data);
    }
    if (p === '/api/scan') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      return await scan(req, res, JSON.parse((await readBody(req)) || '{}'));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

    if (p === '/config.js' && db) {
      // Arahkan app ke emulator lokal, pakai host yang dipakai browser (bisa IP LAN untuk iPhone).
      const origin = `http://${req.headers.host}`;
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
      return res.end(`window.UTANG_CONFIG = { SUPABASE_URL: ${JSON.stringify(origin)}, SUPABASE_ANON_KEY: ${JSON.stringify(LOCAL_KEY)}, LOCAL: true, LOCAL_PIN: ${JSON.stringify(LOCAL_PIN)} };\n`);
    }
    if (PRIVATE.test(p)) return send(res, 404, { error: 'Not found' });
    const file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && /^192\.168\.|^10\./.test(i.address))
    .map((i) => `http://${i.address}:${PORT}`);
  console.log(`\n  Utang Grup — dev server`);
  console.log(`  Laptop : http://localhost:${PORT}`);
  if (lan.length) console.log(`  iPhone : ${lan.join('  atau  ')}  (Wi-Fi sama)`);
  console.log(`  DB     : ${MODE === 'local' ? `LOKAL (.localdb/), PIN: ${LOCAL_PIN}` : 'SUPABASE ASLI — hati-hati, ini data grup!'}`);
  console.log(`  Scan   : ${process.env.SCAN_MOCK === '1' ? 'MOCK (tanpa Gemini)' : process.env.GEMINI_API_KEY ? 'Gemini asli' : 'GEMINI_API_KEY belum diisi (.env.local) — atau pakai SCAN_MOCK=1'}`);
  console.log(`  Ctrl+C untuk berhenti\n`);
});
