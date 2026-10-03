// Mode demo: meniru RPC Supabase di localStorage. Hanya dipakai kalau config.js belum diisi.
(function () {
  const KEY = 'ug_demo_db';
  const PIN = 'demo123';

  function loadDb() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { seq: 1, members: [], transactions: [], log: [] };
  }
  let db = loadDb();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) {} }
  const nextId = () => db.seq++;
  const now = () => new Date().toISOString();
  const fail = (m) => { throw new Error(m); };

  function assertPin(p) { if (p !== PIN) fail('PIN_SALAH'); }
  function assertActor(id) { if (!db.members.some((m) => m.id === id && m.active)) fail('PENGGUNA_TIDAK_DIKENAL'); }
  const live = () => db.transactions.filter((t) => !t.deleted_at);
  function txJson(id) {
    const t = live().find((x) => x.id === id);
    if (!t) return null;
    const { deleted_at, ...rest } = t;
    return JSON.parse(JSON.stringify(rest));
  }
  function balance(id) {
    let b = 0;
    for (const t of live()) {
      if (t.payer_id === id) b += t.amount;
      for (const s of t.shares) if (s.member_id === id) b -= s.amount;
    }
    return b;
  }
  function log(actor, action, txId, before, after) {
    db.log.push({ id: nextId(), actor_id: actor, action, transaction_id: txId, before: before || null, after: after || null, at: now() });
  }
  function cleanName(n) {
    const v = String(n || '').trim();
    if (!v || v.length > 40) fail('Nama wajib diisi (maks 40 karakter)');
    return v;
  }

  const fns = {
    get_state(a) {
      assertPin(a.p_pin);
      const txs = live()
        .map((t) => txJson(t.id))
        .sort((x, y) => (x.tx_date < y.tx_date ? 1 : x.tx_date > y.tx_date ? -1 : y.id - x.id));
      return {
        members: db.members.map((m) => ({ id: m.id, name: m.name, active: m.active })),
        transactions: txs,
        log: db.log.slice().reverse().slice(0, 200),
      };
    },
    add_member(a) {
      assertPin(a.p_pin);
      let actor = a.p_actor;
      if (db.members.length) assertActor(actor); else actor = null;
      const name = cleanName(a.p_name);
      if (db.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) fail('Nama "' + name + '" sudah ada');
      const id = nextId();
      db.members.push({ id, name, active: true });
      log(actor, 'member_add', null, null, { id, name });
      return id;
    },
    update_member(a) {
      assertPin(a.p_pin);
      assertActor(a.p_actor);
      const m = db.members.find((x) => x.id === a.p_id);
      if (!m) fail('Anggota tidak ditemukan');
      const name = cleanName(a.p_name);
      if (db.members.some((x) => x.id !== m.id && x.name.toLowerCase() === name.toLowerCase())) fail('Nama "' + name + '" sudah ada');
      if (m.active && !a.p_active) {
        if (balance(m.id) !== 0) fail('Saldo ' + m.name + ' belum nol, lunasi dulu sebelum dinonaktifkan');
        if (m.id === a.p_actor) fail('Tidak bisa menonaktifkan diri sendiri');
      }
      const before = { id: m.id, name: m.name, active: m.active };
      m.name = name;
      m.active = !!a.p_active;
      log(a.p_actor, 'member_update', null, before, { id: m.id, name, active: m.active });
    },
    save_transaction(a) {
      assertPin(a.p_pin);
      assertActor(a.p_actor);
      if (!['split', 'debt', 'settlement'].includes(a.p_kind)) fail('Jenis transaksi tidak valid');
      if (!(a.p_amount > 0)) fail('Jumlah harus lebih dari 0');
      if (!db.members.some((m) => m.id === a.p_payer)) fail('Pembayar tidak ditemukan');
      const shares = (a.p_shares || []).filter((s) => s.amount > 0).map((s) => ({ member_id: s.member_id, amount: s.amount }));
      if (!shares.length) fail('Pilih minimal satu orang');
      if (shares.some((s) => !db.members.some((m) => m.id === s.member_id))) fail('Data pembagian tidak valid');
      const sum = shares.reduce((x, s) => x + s.amount, 0);
      if (sum !== a.p_amount) fail('Total pembagian (' + sum + ') tidak sama dengan jumlah (' + a.p_amount + ')');
      if (a.p_kind !== 'split') {
        if (shares.length !== 1) fail('Utang/pelunasan harus ke tepat satu orang');
        if (shares[0].member_id === a.p_payer) fail('Dua orangnya tidak boleh sama');
      }
      shares.sort((x, y) => x.member_id - y.member_id);
      const fields = { kind: a.p_kind, payer_id: a.p_payer, amount: a.p_amount, note: String(a.p_note || '').trim(), tx_date: a.p_date, shares };
      let id, before = null;
      if (a.p_id == null) {
        id = nextId();
        const ts = now();
        db.transactions.push(Object.assign({ id, created_by: a.p_actor, updated_by: a.p_actor, created_at: ts, updated_at: ts, deleted_at: null }, fields));
      } else {
        before = txJson(a.p_id);
        if (!before) fail('Transaksi tidak ditemukan');
        const t = db.transactions.find((x) => x.id === a.p_id);
        Object.assign(t, fields, { updated_by: a.p_actor, updated_at: now() });
        id = t.id;
      }
      log(a.p_actor, a.p_id == null ? 'tx_create' : 'tx_update', id, before, txJson(id));
      return id;
    },
    delete_transaction(a) {
      assertPin(a.p_pin);
      assertActor(a.p_actor);
      const before = txJson(a.p_id);
      if (!before) fail('Transaksi tidak ditemukan');
      const t = db.transactions.find((x) => x.id === a.p_id);
      t.deleted_at = t.updated_at = now();
      t.updated_by = a.p_actor;
      log(a.p_actor, 'tx_delete', a.p_id, before, null);
    },
    change_pin(a) {
      assertPin(a.p_pin);
      fail('Mode demo: PIN tetap demo123');
    },
  };

  window.UtangDemo = {
    PIN,
    createClient() {
      return {
        async rpc(fn, args) {
          db = loadDb();
          try {
            const data = fns[fn](args);
            save();
            return { data: data === undefined ? null : data, error: null };
          } catch (e) {
            return { data: null, error: { message: e.message } };
          }
        },
      };
    },
    reset() { try { localStorage.removeItem(KEY); } catch (_) {} db = loadDb(); },
  };
})();
