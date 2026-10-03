import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const PIN = 'rahasia123';
const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

async function freshDb(pin) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('create schema extensions; create role anon nologin; create role authenticated nologin;');
  const sql = pin ? schema.replace("values (1, extensions.crypt('GANTI-PIN-INI'", `values (1, extensions.crypt('${pin}'`) : schema;
  await db.exec(sql);
  await db.exec(sql); // harus idempotent
  return db;
}
const q = async (db, s, p = []) => (await db.query(s, p)).rows;
const rejects = (db, s, p, re) => assert.rejects(db.query(s, p), re);

test('placeholder PIN tidak bisa dipakai login', async () => {
  const db = await freshDb(null);
  await rejects(db, "select get_state('GANTI-PIN-INI')", [], /PIN_BELUM_DISET/);
});

test('nota: simpan, lihat, hapus, terkunci', async () => {
  const db = await freshDb(PIN);
  const a = (await q(db, "select add_member($1,null,'Andi') id", [PIN]))[0].id;
  const t = (await q(db, "select save_transaction($1,$2,null,'split',$2,1000,'x',null,$3::jsonb) id",
    [PIN, a, JSON.stringify([{ member_id: a, amount: 1000 }])]))[0].id;
  await rejects(db, 'select set_receipt($1,$2,$3,$4)', ['salah', a, t, 'QUJD'], /PIN_SALAH/);
  await rejects(db, 'select set_receipt($1,$2,$3,$4)', [PIN, a, t, '<script>'], /tidak valid/);
  await rejects(db, 'select set_receipt($1,$2,$3,$4)', [PIN, a, 9999, 'QUJD'], /tidak ditemukan/);
  await q(db, 'select set_receipt($1,$2,$3,$4)', [PIN, a, t, 'QUJD']);
  await q(db, 'select set_receipt($1,$2,$3,$4)', [PIN, a, t, 'RUZH']); // ganti
  assert.strictEqual((await q(db, 'select get_receipt($1,$2) r', [PIN, t]))[0].r, 'RUZH');
  await rejects(db, 'select get_receipt($1,$2)', ['salah', t], /PIN_SALAH/);
  let st = (await q(db, 'select get_state($1) s', [PIN]))[0].s;
  assert.deepStrictEqual(st.receipt_ids, [t]);
  await q(db, 'select set_receipt($1,$2,$3,$4)', [PIN, a, t, '']);
  st = (await q(db, 'select get_state($1) s', [PIN]))[0].s;
  assert.deepStrictEqual(st.receipt_ids, []);
  assert.deepStrictEqual(st.log.slice(0, 3).map((l) => l.action), ['receipt_remove', 'receipt_set', 'receipt_set']);
  await db.exec('set role anon');
  await rejects(db, 'select * from receipts', [], /permission denied/);
});

test('alur lengkap RPC + keamanan', async () => {
  const db = await freshDb(PIN);
  await rejects(db, 'select get_state($1)', ['salah'], /PIN_SALAH/);
  const a = (await q(db, "select add_member($1,null,'Andi') id", [PIN]))[0].id;
  await rejects(db, "select add_member($1,null,'Budi')", [PIN], /PENGGUNA_TIDAK_DIKENAL/);
  const b = (await q(db, "select add_member($1,$2,'Budi') id", [PIN, a]))[0].id;
  const c = (await q(db, "select add_member($1,$2,'Cici') id", [PIN, a]))[0].id;
  await rejects(db, "select add_member($1,$2,'budi')", [PIN, a], /sudah ada/);

  const sh = JSON.stringify([{ member_id: a, amount: 33334 }, { member_id: b, amount: 33333 }, { member_id: c, amount: 33333 }]);
  const t1 = (await q(db, "select save_transaction($1,$2,null,'split',$3,100000,'Makan',null,$4::jsonb) id", [PIN, a, a, sh]))[0].id;
  await rejects(db, "select save_transaction($1,$2,null,'split',$3,100001,'x',null,$4::jsonb)", [PIN, a, a, sh], /Total pembagian/);
  await rejects(db, "select save_transaction($1,$2,null,'debt',$3,5000,'x',null,$4::jsonb)",
    [PIN, a, a, JSON.stringify([{ member_id: a, amount: 5000 }])], /tidak boleh sama/);
  await q(db, "select save_transaction($1,$2,null,'debt',$3,50000,'',null,$4::jsonb)",
    [PIN, b, c, JSON.stringify([{ member_id: b, amount: 50000 }])]);
  await q(db, "select save_transaction($1,$2,null,'settlement',$3,33333,'',null,$4::jsonb)",
    [PIN, b, b, JSON.stringify([{ member_id: a, amount: 33333 }])]);

  const bal = async (id) => Number((await q(db, 'select member_balance($1) v', [id]))[0].v);
  assert.deepStrictEqual([await bal(a), await bal(b), await bal(c)], [33333, -50000, 16667]);
  await rejects(db, "select update_member($1,$2,$3,'Budi',false)", [PIN, a, b], /belum nol/);

  await q(db, "select save_transaction($1,$2,$3,'split',$4,90000,'Edit',null,$5::jsonb)", [PIN, b, t1, a,
    JSON.stringify([{ member_id: a, amount: 30000 }, { member_id: b, amount: 30000 }, { member_id: c, amount: 30000 }])]);
  await q(db, 'select delete_transaction($1,$2,$3)', [PIN, c, t1]);
  const st = (await q(db, 'select get_state($1) s', [PIN]))[0].s;
  assert.strictEqual(st.transactions.length, 2);
  assert.deepStrictEqual(st.log.slice(0, 3).map((l) => l.action), ['tx_delete', 'tx_update', 'tx_create']);

  assert.strictEqual((await q(db, 'select check_pin($1) ok', [PIN]))[0].ok, true);
  await q(db, "select change_pin($1,$2,'barubaru1')", [PIN, a]);
  await rejects(db, 'select get_state($1)', [PIN], /PIN_SALAH/);

  await db.exec('set role anon');
  await rejects(db, 'select * from transactions', [], /permission denied/);
  await rejects(db, 'select * from settings', [], /permission denied/);
  await rejects(db, "select assert_pin('x')", [], /permission denied/);
  await q(db, "select get_state('barubaru1')");
});
