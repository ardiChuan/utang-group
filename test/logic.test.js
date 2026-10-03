const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const M = [1, 2, 3, 4, 5, 6].map((id) => ({ id }));
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('equalSplit membagi sisa rupiah ke anggota pertama', () => {
  const s = L.equalSplit(100000, [3, 1, 2]);
  assert.deepStrictEqual(s.map((x) => x.amount), [33334, 33333, 33333]);
});

test('saldo: split, utang langsung, pelunasan', () => {
  const tx = [
    { payer_id: 1, amount: 300000, shares: L.equalSplit(300000, [1, 2, 3]) },
    { payer_id: 4, amount: 50000, shares: [{ member_id: 2, amount: 50000 }] },
    { payer_id: 2, amount: 100000, shares: [{ member_id: 1, amount: 100000 }] },
  ];
  const b = L.computeBalances(M, tx);
  assert.strictEqual(sum(b), 0);
  assert.strictEqual(b[1], 100000);
  assert.strictEqual(b[2], -50000);
});

test('simplify selalu menolkan semua saldo (acak)', () => {
  for (let k = 0; k < 1000; k++) {
    const txs = [];
    for (let i = 0; i < 10; i++) {
      const amt = 1 + Math.floor(Math.random() * 1e6);
      const ids = M.map((m) => m.id).filter(() => Math.random() < 0.6);
      if (ids.length) txs.push({ payer_id: 1 + Math.floor(Math.random() * 6), amount: amt, shares: L.equalSplit(amt, ids) });
    }
    const b = L.computeBalances(M, txs);
    assert.strictEqual(sum(b), 0);
    const after = { ...b };
    for (const t of L.simplify(b)) {
      assert.ok(t.amount > 0);
      after[t.from] += t.amount;
      after[t.to] -= t.amount;
    }
    assert.ok(Object.values(after).every((v) => v === 0));
  }
});

test('allocateReceipt: item bareng + pajak proporsional', () => {
  const r = L.allocateReceipt(110000, [
    { price: 30000, who: [1] },
    { price: 60000, who: [1, 2] },
    { price: 10000, who: [3] },
  ]);
  assert.deepStrictEqual(r.map((s) => s.amount), [66000, 33000, 11000]);
});

test('allocateReceipt: total selalu pas (acak)', () => {
  for (let k = 0; k < 2000; k++) {
    const items = [];
    for (let i = 0; i < 1 + Math.random() * 8; i++) {
      items.push({ price: Math.floor(Math.random() * 90000) + 1, who: [1, 2, 3, 4, 5, 6].filter(() => Math.random() < 0.4) });
    }
    const t = Math.floor(Math.random() * 500000) + 1;
    const s = L.allocateReceipt(t, items);
    if (s.length) assert.strictEqual(s.reduce((a, x) => a + x.amount, 0), t);
  }
});
