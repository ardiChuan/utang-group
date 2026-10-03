// Logika murni: saldo, bagi rata, simplify. Dipakai app.js dan test.js.
(function (root) {
  // Saldo positif = orang lain utang ke dia. Negatif = dia yang utang.
  function computeBalances(members, transactions) {
    const bal = {};
    for (const m of members) bal[m.id] = 0;
    for (const t of transactions) {
      bal[t.payer_id] = (bal[t.payer_id] || 0) + t.amount;
      for (const s of t.shares) {
        bal[s.member_id] = (bal[s.member_id] || 0) - s.amount;
      }
    }
    return bal;
  }

  // Bagi rata dalam rupiah bulat; sisa dibagikan 1 rupiah ke anggota pertama.
  function equalSplit(amount, memberIds) {
    const ids = [...memberIds].sort((a, b) => a - b);
    const n = ids.length;
    if (!n || amount <= 0) return [];
    const base = Math.floor(amount / n);
    let rem = amount - base * n;
    return ids.map((id) => {
      const extra = rem > 0 ? 1 : 0;
      rem -= extra;
      return { member_id: id, amount: base + extra };
    });
  }

  // Greedy: cocokkan penagih terbesar dengan pengutang terbesar.
  function simplify(balances) {
    const creditors = [];
    const debtors = [];
    for (const [id, v] of Object.entries(balances)) {
      if (v > 0) creditors.push({ id: Number(id), amt: v });
      else if (v < 0) debtors.push({ id: Number(id), amt: -v });
    }
    const out = [];
    while (creditors.length && debtors.length) {
      creditors.sort((a, b) => b.amt - a.amt);
      debtors.sort((a, b) => b.amt - a.amt);
      const c = creditors[0];
      const d = debtors[0];
      const x = Math.min(c.amt, d.amt);
      out.push({ from: d.id, to: c.id, amount: x });
      c.amt -= x;
      d.amt -= x;
      if (!c.amt) creditors.shift();
      if (!d.amt) debtors.shift();
    }
    return out;
  }

  // Bagi total struk ke anggota berdasarkan item yang mereka ambil.
  // Item dibagi rata ke pemiliknya; selisih (pajak/service/diskon) ikut proporsional.
  // Pembulatan largest-remainder supaya jumlahnya pas dengan total.
  function allocateReceipt(total, items) {
    const w = {};
    for (const it of items) {
      if (!(it.price > 0) || !it.who.length) continue;
      for (const id of it.who) w[id] = (w[id] || 0) + it.price / it.who.length;
    }
    const ids = Object.keys(w).map(Number).sort((a, b) => a - b);
    const sumW = ids.reduce((a, id) => a + w[id], 0);
    if (!ids.length || !(sumW > 0) || !(total > 0)) return [];
    const raw = ids.map((id) => ({ id, v: (total * w[id]) / sumW }));
    const out = raw.map((r) => ({ member_id: r.id, amount: Math.floor(r.v), frac: r.v - Math.floor(r.v) }));
    let rem = total - out.reduce((a, s) => a + s.amount, 0);
    const order = out.slice().sort((a, b) => b.frac - a.frac || a.member_id - b.member_id);
    for (let i = 0; rem > 0; i = (i + 1) % order.length, rem--) order[i].amount++;
    return out.map(({ member_id, amount }) => ({ member_id, amount })).filter((s) => s.amount > 0);
  }

  const api = { computeBalances, equalSplit, simplify, allocateReceipt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UtangLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
