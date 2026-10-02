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

  const api = { computeBalances, equalSplit, simplify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UtangLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
