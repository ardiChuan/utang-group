(function () {
  'use strict';

  const { computeBalances, equalSplit, simplify, allocateReceipt } = window.UtangLogic;
  const cfg = window.UTANG_CONFIG || {};
  const root = document.getElementById('root');
  const toastEl = document.getElementById('toast');

  // ---------- Storage (bisa gagal di private mode) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) {
      try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, String(v)); } catch (_) {}
    },
  };

  const S = {
    pin: store.get('ug_pin'),
    meId: Number(store.get('ug_me')) || null,
    data: null,
    tab: 'saldo',
    histView: 'tx',
    loading: false,
    busy: false,
    form: null,
    sheet: null,
    gateError: '',
    scan: null,
    scanning: false,
  };

  // ---------- Util ----------
  const nf = new Intl.NumberFormat('id-ID');
  const rp = (n) => 'Rp ' + nf.format(n);
  const parseAmt = (s) => Number(String(s || '').replace(/\D/g, '')) || 0;
  const fmtInput = (n) => (n ? nf.format(n) : '');
  const today = () => new Date().toLocaleDateString('en-CA');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const members = () => (S.data ? S.data.members : []);
  const activeMembers = () => members().filter((m) => m.active);
  const memberName = (id) => { const m = members().find((x) => x.id === id); return m ? m.name : '?'; };
  const initial = (id) => memberName(id).trim().charAt(0).toUpperCase() || '?';
  const KIND_LABEL = { split: 'Split bill', debt: 'Utang', settlement: 'Pelunasan' };

  function fmtDate(d) {
    const dt = new Date(d + 'T00:00:00');
    const t = today();
    if (d === t) return 'Hari ini';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (d === y.toLocaleDateString('en-CA')) return 'Kemarin';
    return dt.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  let toastTimer;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, isErr ? 4000 : 2200);
  }

  const ICON = {
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M12 4v16M4 12h16"/></svg>',
    debt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    settlement: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  };

  // ---------- Supabase ----------
  const configured = cfg.SUPABASE_URL && !/XXXX/.test(cfg.SUPABASE_URL) && cfg.SUPABASE_ANON_KEY && !/ISI-/.test(cfg.SUPABASE_ANON_KEY);
  const demo = !configured && store.get('ug_demo_mode') === '1' && !!window.UtangDemo;
  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    : demo ? window.UtangDemo.createClient() : null;

  function friendly(msg) {
    if (/PIN_BELUM_DISET/.test(msg)) return 'PIN grup belum diset di Supabase (lihat README).';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Gagal konek. Cek internet, atau project Supabase sedang pause.';
    if (/Could not find the function/i.test(msg)) return 'Fungsi database belum ada. Jalankan schema.sql di Supabase.';
    return msg;
  }

  async function rpc(fn, args) {
    let res;
    try {
      res = await sb.rpc(fn, Object.assign({ p_pin: S.pin }, args || {}));
    } catch (e) {
      throw new Error(friendly(e.message || 'Gagal'));
    }
    if (res.error) {
      const msg = res.error.message || 'Gagal';
      if (/PIN_SALAH/.test(msg)) {
        lockOut('PIN salah atau sudah diganti.');
        throw new Error('PIN_SALAH');
      }
      if (/PENGGUNA_TIDAK_DIKENAL/.test(msg)) {
        setMe(null);
        render();
        throw new Error('Pilih nama kamu lagi.');
      }
      throw new Error(friendly(msg));
    }
    return res.data;
  }

  function lockOut(msg) {
    S.pin = null;
    S.data = null;
    S.sheet = null;
    store.set('ug_pin', null);
    S.gateError = msg || '';
    render();
  }
  function setMe(id) {
    S.meId = id;
    store.set('ug_me', id);
  }

  async function load(silent) {
    if (!S.pin) return;
    S.loading = true;
    if (!silent) render(); else updateRefreshIcon();
    try {
      S.data = await rpc('get_state');
      const me = S.data.members.find((m) => m.id === S.meId);
      if (!me || !me.active) setMe(null);
      // Form yang belum disentuh ikut daftar anggota terbaru.
      if (!S.form || (!S.form.id && !S.form.amount)) S.form = newForm(S.form ? S.form.kind : 'split');
    } catch (e) {
      if (e.message !== 'PIN_SALAH') toast(e.message, true);
    } finally {
      S.loading = false;
      render();
    }
  }

  async function act(fn) {
    if (S.busy) return;
    S.busy = true;
    try { await fn(); }
    catch (e) { if (e.message !== 'PIN_SALAH') toast(e.message, true); }
    finally { S.busy = false; }
  }

  // ---------- Form state ----------
  function newForm(kind) {
    const ids = activeMembers().map((m) => m.id);
    const other = ids.find((id) => id !== S.meId) || null;
    return {
      id: null,
      kind: kind || 'split',
      amount: 0,
      note: '',
      date: today(),
      payer: S.meId,
      participants: ids,
      mode: 'equal',
      custom: {},
      from: S.meId,
      to: other,
    };
  }

  function formFromTx(t) {
    const f = newForm(t.kind);
    f.id = t.id;
    f.amount = t.amount;
    f.note = t.note;
    f.date = t.tx_date;
    if (t.kind === 'split') {
      f.payer = t.payer_id;
      f.participants = t.shares.map((s) => s.member_id);
      const eq = equalSplit(t.amount, f.participants);
      const same = eq.every((e) => (t.shares.find((s) => s.member_id === e.member_id) || {}).amount === e.amount);
      f.mode = same ? 'equal' : 'custom';
      f.custom = {};
      for (const s of t.shares) f.custom[s.member_id] = s.amount;
    } else if (t.kind === 'debt') {
      f.from = t.shares[0].member_id;
      f.to = t.payer_id;
    } else {
      f.from = t.payer_id;
      f.to = t.shares[0].member_id;
    }
    return f;
  }

  function customSum(f) {
    return f.participants.reduce((a, id) => a + (f.custom[id] || 0), 0);
  }

  function buildPayload(f) {
    if (!f.amount || f.amount <= 0) throw new Error('Isi jumlahnya dulu.');
    let payer, shares;
    if (f.kind === 'split') {
      if (!f.payer) throw new Error('Pilih siapa yang bayar.');
      if (!f.participants.length) throw new Error('Pilih minimal satu orang.');
      if (f.mode === 'equal') {
        shares = equalSplit(f.amount, f.participants);
      } else {
        shares = f.participants.map((id) => ({ member_id: id, amount: f.custom[id] || 0 })).filter((s) => s.amount > 0);
        const sum = shares.reduce((a, s) => a + s.amount, 0);
        if (sum !== f.amount) throw new Error('Total pembagian ' + rp(sum) + ' belum sama dengan ' + rp(f.amount) + '.');
      }
      payer = f.payer;
    } else {
      if (!f.from || !f.to) throw new Error('Pilih dua orangnya.');
      if (f.from === f.to) throw new Error('Dua orangnya tidak boleh sama.');
      if (f.kind === 'debt') { payer = f.to; shares = [{ member_id: f.from, amount: f.amount }]; }
      else { payer = f.from; shares = [{ member_id: f.to, amount: f.amount }]; }
    }
    return {
      p_actor: S.meId,
      p_id: f.id,
      p_kind: f.kind,
      p_payer: payer,
      p_amount: f.amount,
      p_note: f.note,
      p_date: f.date || today(),
      p_shares: shares,
    };
  }

  // ---------- Render ----------
  function render() {
    if (!sb) { root.innerHTML = viewNotConfigured(); return; }
    if (!S.pin) { root.innerHTML = viewPin(); return; }
    if (!S.data) { root.innerHTML = '<div class="gate"><p class="muted">Memuat…</p></div>'; return; }
    if (!S.meId) { root.innerHTML = viewWho(); return; }
    root.innerHTML = viewShell() + (S.sheet ? viewSheet() : '');
  }

  function updateRefreshIcon() {
    const b = document.querySelector('[data-act="refresh"]');
    if (b) b.classList.toggle('spin', S.loading);
  }

  function viewNotConfigured() {
    return `<div class="gate"><h1>Belum dikonfigurasi</h1>
      <p>Isi <b>SUPABASE_URL</b> dan <b>SUPABASE_ANON_KEY</b> di <code>config.js</code>, lalu deploy ulang. Lihat README.</p>
      ${window.UtangDemo ? '<button class="btn ghost block" data-act="demo">Coba mode demo</button><p class="small" style="margin-top:8px">Data demo hanya tersimpan di browser ini.</p>' : ''}</div>`;
  }

  function viewPin() {
    return `<form class="gate" data-form="pin" autocomplete="off">
      <h1>Utang Grup</h1>
      <p>Masukkan PIN grup.${demo ? ' Mode demo: PIN <b>' + window.UtangDemo.PIN + '</b>' : ''}</p>
      <div class="field"><input class="input" type="password" name="pin" autocomplete="current-password" placeholder="PIN grup" required autofocus></div>
      ${S.gateError ? `<p class="neg small" style="margin:-4px 2px 16px">${esc(S.gateError)}</p>` : ''}
      <button class="btn block" type="submit">Masuk</button>
    </form>`;
  }

  function viewWho() {
    const list = activeMembers();
    if (!list.length) {
      return `<form class="gate" data-form="first-member">
        <h1>Halo!</h1>
        <p>Belum ada anggota. Mulai dengan nama kamu, anggota lain bisa ditambah nanti di tab Anggota.</p>
        <div class="field"><input class="input" name="name" placeholder="Nama kamu" maxlength="40" required></div>
        <button class="btn block" type="submit">Lanjut</button>
      </form>`;
    }
    return `<div class="gate">
      <h1>Kamu siapa?</h1>
      <p>Pilih nama kamu. Bisa diganti nanti.</p>
      <div class="who-list">${list.map((m) => `<button data-act="pick-me" data-id="${m.id}">${esc(m.name)}</button>`).join('')}</div>
      <p style="margin-top:24px"><button class="btn ghost block" data-act="logout">Keluar</button></p>
    </div>`;
  }

  function viewShell() {
    const tabs = [
      ['saldo', 'Saldo', ICON.wallet],
      ['tambah', 'Tambah', ICON.plus],
      ['riwayat', 'Riwayat', ICON.clock],
      ['anggota', 'Anggota', ICON.users],
    ];
    const body = { saldo: viewSaldo, tambah: viewTambah, riwayat: viewRiwayat, anggota: viewAnggota }[S.tab]();
    return `
      <header class="topbar"><div class="wrap">
        <h1>Utang Grup${demo ? ' <span class="badge">DEMO</span>' : ''}</h1>
        <span class="chip">${esc(memberName(S.meId))}</span>
        <button class="icon-btn${S.loading ? ' spin' : ''}" data-act="refresh" aria-label="Muat ulang">${ICON.refresh}</button>
      </div></header>
      <main><div class="wrap">${body}</div></main>
      <nav class="tabbar"><div class="wrap">
        ${tabs.map(([k, l, ic]) => `<button data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${ic}<span>${l}</span></button>`).join('')}
      </div></nav>`;
  }

  // ----- Saldo -----
  function viewSaldo() {
    const bal = computeBalances(members(), S.data.transactions);
    const mine = bal[S.meId] || 0;
    const transfers = simplify(bal);
    const hero = mine > 0
      ? `<div class="hero pos"><div class="label">Kamu akan dapat</div><div class="big">${rp(mine)}</div></div>`
      : mine < 0
        ? `<div class="hero neg"><div class="label">Kamu masih utang</div><div class="big">${rp(-mine)}</div></div>`
        : `<div class="hero"><div class="label">Saldo kamu</div><div class="big">Lunas</div></div>`;

    const tRows = transfers.length
      ? transfers.map((t, i) => {
          const isMine = t.from === S.meId || t.to === S.meId;
          return `<div class="row transfer${isMine ? ' mine' : ''}">
            <div class="grow">
              <div class="title">${esc(memberName(t.from))} <span class="arrow">→</span> ${esc(memberName(t.to))}</div>
              <div class="sub amt" style="text-align:left">${rp(t.amount)}</div>
            </div>
            <button class="btn sm" data-act="settle" data-i="${i}">Tandai lunas</button>
          </div>`;
        }).join('')
      : `<div class="empty">Semua sudah lunas.</div>`;

    const list = members().filter((m) => m.active || bal[m.id]);
    const bRows = list.map((m) => {
      const v = bal[m.id] || 0;
      const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted';
      const lbl = v > 0 ? 'dapat ' + rp(v) : v < 0 ? 'utang ' + rp(-v) : 'lunas';
      return `<div class="row">
        <div class="avatar">${esc(initial(m.id))}</div>
        <div class="grow"><div class="title">${esc(m.name)}${m.id === S.meId ? ' <span class="badge">kamu</span>' : ''}</div></div>
        <div class="amt ${cls}">${lbl}</div>
      </div>`;
    }).join('');

    return `${hero}
      <div class="section-title">Cara lunas paling simpel</div>
      <div class="card">${tRows}</div>
      <div class="section-title">Saldo semua</div>
      <div class="card">${bRows || '<div class="empty">Belum ada anggota.</div>'}</div>`;
  }

  // ----- Tambah / Edit -----
  function memberOptions(selected, includeIds) {
    const extra = new Set(includeIds || []);
    return members()
      .filter((m) => m.active || extra.has(m.id) || m.id === selected)
      .map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}${m.active ? '' : ' (nonaktif)'}</option>`)
      .join('');
  }

  function viewTambah() {
    const f = S.form || (S.form = newForm('split'));
    const seg = [['split', 'Split bill'], ['debt', 'Utang'], ['settlement', 'Bayar utang']]
      .map(([k, l]) => `<button type="button" data-act="kind" data-kind="${k}" aria-pressed="${f.kind === k}">${l}</button>`).join('');

    const amountField = `<div class="field"><label for="f-amount">Jumlah</label>
      <div class="money-wrap"><span>Rp</span><input id="f-amount" class="input money" data-f="amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${fmtInput(f.amount)}"></div></div>`;
    const noteField = `<div class="field"><label for="f-note">Keterangan</label>
      <input id="f-note" class="input" data-f="note" maxlength="120" placeholder="${f.kind === 'split' ? 'Makan malam, bensin, …' : 'Opsional'}" value="${esc(f.note)}"></div>`;
    const dateField = `<div class="field"><label for="f-date">Tanggal</label>
      <input id="f-date" class="input" type="date" data-f="date" value="${esc(f.date)}"></div>`;

    let body = '';
    if (f.kind === 'split') {
      const chips = members()
        .filter((m) => m.active || f.participants.includes(m.id))
        .map((m) => `<button type="button" data-act="toggle-part" data-id="${m.id}" aria-pressed="${f.participants.includes(m.id)}">${esc(m.name)}</button>`).join('');
      const modeSeg = `<div class="seg" style="margin-bottom:8px">
        <button type="button" data-act="mode" data-mode="equal" aria-pressed="${f.mode === 'equal'}">Rata</button>
        <button type="button" data-act="mode" data-mode="custom" aria-pressed="${f.mode === 'custom'}">Custom</button></div>`;
      const customRows = f.mode === 'custom'
        ? `<div class="card">${f.participants.map((id) => `<div class="split-row"><span class="name">${esc(memberName(id))}</span>
            <input class="input" data-f="custom" data-id="${id}" inputmode="numeric" placeholder="0" value="${fmtInput(f.custom[id] || 0)}"></div>`).join('')}</div>`
        : '';
      const scanBtn = `<div class="field">
        <label class="btn ghost block scan-btn${S.scanning ? ' is-busy' : ''}" ${S.scanning ? '' : 'for="scan-file"'}>${ICON.camera}<span>${S.scanning ? 'Membaca struk…' : 'Scan struk'}</span></label></div>`;
      body = `${scanBtn}${amountField}${noteField}
        <div class="field"><label for="f-payer">Dibayar oleh</label>
          <select id="f-payer" class="input" data-f="payer">${memberOptions(f.payer)}</select></div>
        <div class="field"><span class="lbl">Dibagi ke <button type="button" class="btn ghost sm" style="margin-left:6px;min-height:28px" data-act="toggle-all">${f.participants.length === activeMembers().length ? 'Kosongkan' : 'Semua'}</button></span>
          <div class="chips">${chips}</div></div>
        <div class="field"><span class="lbl">Pembagian</span>${modeSeg}${customRows}
          <p class="hint muted" id="split-hint">${splitHint(f)}</p></div>
        ${dateField}`;
    } else if (f.kind === 'debt') {
      body = `<div class="field"><label for="f-from">Siapa yang utang</label>
          <select id="f-from" class="input" data-f="from">${memberOptions(f.from)}</select></div>
        <div class="field"><label for="f-to">Utang ke siapa</label>
          <select id="f-to" class="input" data-f="to">${memberOptions(f.to)}</select></div>
        ${amountField}${noteField}${dateField}`;
    } else {
      body = `<div class="field"><label for="f-from">Siapa yang bayar</label>
          <select id="f-from" class="input" data-f="from">${memberOptions(f.from)}</select></div>
        <div class="field"><label for="f-to">Bayar ke siapa</label>
          <select id="f-to" class="input" data-f="to">${memberOptions(f.to)}</select></div>
        ${amountField}${noteField}${dateField}`;
    }

    return `<form data-form="tx" autocomplete="off">
      ${f.id ? '<div class="section-title" style="margin-top:0">Edit transaksi</div>' : ''}
      <div class="seg">${seg}</div>
      ${body}
      <div class="form-actions">
        ${f.id ? '<button type="button" class="btn ghost" data-act="cancel-edit">Batal</button>' : ''}
        <button type="submit" class="btn">${f.id ? 'Simpan perubahan' : 'Simpan'}</button>
      </div>
    </form>`;
  }

  function splitHint(f) {
    if (!f.participants.length) return 'Pilih minimal satu orang.';
    if (f.mode === 'equal') {
      if (!f.amount) return f.participants.length + ' orang, dibagi rata.';
      const shares = equalSplit(f.amount, f.participants);
      const lo = shares[shares.length - 1].amount;
      const hi = shares[0].amount;
      return f.participants.length + ' orang × ' + (lo === hi ? rp(lo) : '±' + rp(lo)) + ' per orang';
    }
    const diff = f.amount - customSum(f);
    if (diff === 0) return '<span class="pos">Pas, total sudah sesuai.</span>';
    return diff > 0
      ? '<span class="neg">Sisa ' + rp(diff) + ' belum dibagi.</span>'
      : '<span class="neg">Kelebihan ' + rp(-diff) + '.</span>';
  }

  // ----- Riwayat -----
  function txTitle(t) {
    return t.note || KIND_LABEL[t.kind];
  }
  function txSub(t) {
    if (t.kind === 'split') return esc(memberName(t.payer_id)) + ' bayar · ' + t.shares.length + ' orang';
    if (t.kind === 'debt') return esc(memberName(t.shares[0].member_id)) + ' utang ke ' + esc(memberName(t.payer_id));
    return esc(memberName(t.payer_id)) + ' bayar ke ' + esc(memberName(t.shares[0].member_id));
  }
  function myEffect(t) {
    const share = (t.shares.find((s) => s.member_id === S.meId) || {}).amount || 0;
    return (t.payer_id === S.meId ? t.amount : 0) - share;
  }

  function viewRiwayat() {
    const seg = `<div class="seg">
      <button type="button" data-act="hist" data-v="tx" aria-pressed="${S.histView === 'tx'}">Transaksi</button>
      <button type="button" data-act="hist" data-v="log" aria-pressed="${S.histView === 'log'}">Aktivitas</button></div>`;
    if (S.histView === 'log') return seg + viewLog();

    const txs = S.data.transactions;
    if (!txs.length) return seg + '<div class="empty">Belum ada transaksi.</div>';
    let html = '';
    let curDate = null;
    let open = false;
    for (const t of txs) {
      if (t.tx_date !== curDate) {
        if (open) html += '</div>';
        curDate = t.tx_date;
        html += `<div class="date-head">${esc(fmtDate(t.tx_date))}</div><div class="card">`;
        open = true;
      }
      const eff = myEffect(t);
      html += `<button class="row" data-act="open-tx" data-id="${t.id}">
        <div class="kind-ic">${ICON[t.kind]}</div>
        <div class="grow"><div class="title">${esc(txTitle(t))}</div><div class="sub">${txSub(t)}</div></div>
        <div><div class="amt">${rp(t.amount)}</div>
          ${eff ? `<div class="amt small ${eff > 0 ? 'pos' : 'neg'}">${eff > 0 ? '+' : '−'}${rp(Math.abs(eff))}</div>` : ''}</div>
      </button>`;
    }
    if (open) html += '</div>';
    return seg + html;
  }

  function describeTxJson(j) {
    if (!j) return '';
    return '"' + esc(j.note || KIND_LABEL[j.kind]) + '" ' + rp(j.amount);
  }

  function viewLog() {
    const log = S.data.log;
    if (!log.length) return '<div class="empty">Belum ada aktivitas.</div>';
    const rows = log.map((l) => {
      const who = l.actor_id ? esc(memberName(l.actor_id)) : 'Sistem';
      let what;
      switch (l.action) {
        case 'tx_create': what = 'menambah ' + describeTxJson(l.after); break;
        case 'tx_update': what = 'mengubah ' + describeTxJson(l.before) + (l.after && l.before && (l.after.amount !== l.before.amount || l.after.note !== l.before.note) ? ' → ' + describeTxJson(l.after) : ''); break;
        case 'tx_delete': what = 'menghapus ' + describeTxJson(l.before); break;
        case 'member_add': what = 'menambah anggota ' + esc(l.after && l.after.name); break;
        case 'member_update':
          if (l.before.name !== l.after.name) what = 'mengganti nama ' + esc(l.before.name) + ' jadi ' + esc(l.after.name);
          else if (l.before.active !== l.after.active) what = (l.after.active ? 'mengaktifkan ' : 'menonaktifkan ') + esc(l.after.name);
          else what = 'mengubah anggota ' + esc(l.after.name);
          break;
        case 'pin_change': what = 'mengganti PIN grup'; break;
        default: what = esc(l.action);
      }
      return `<div class="row"><div class="grow"><div class="small"><b>${who}</b> ${what}</div>
        <div class="sub">${esc(fmtTime(l.at))}</div></div></div>`;
    }).join('');
    return `<div class="card">${rows}</div>`;
  }

  // ----- Anggota -----
  function viewAnggota() {
    const bal = computeBalances(members(), S.data.transactions);
    const rows = members().map((m) => {
      const v = bal[m.id] || 0;
      const lbl = v > 0 ? `<span class="pos">dapat ${rp(v)}</span>` : v < 0 ? `<span class="neg">utang ${rp(-v)}</span>` : 'lunas';
      return `<div class="row"${m.active ? '' : ' style="opacity:.55"'}>
        <div class="avatar">${esc(initial(m.id))}</div>
        <div class="grow"><div class="title">${esc(m.name)}${m.active ? '' : ' <span class="badge">nonaktif</span>'}</div><div class="sub">${lbl}</div></div>
        <button class="btn ghost sm" data-act="rename" data-id="${m.id}">Ubah</button>
        ${m.id === S.meId ? '' : `<button class="btn ghost sm" data-act="toggle-active" data-id="${m.id}">${m.active ? 'Nonaktif' : 'Aktifkan'}</button>`}
      </div>`;
    }).join('');

    return `<div class="section-title" style="margin-top:0">Anggota</div>
      <div class="card">${rows}</div>
      <form data-form="add-member" style="display:flex;gap:8px;margin-top:10px">
        <input class="input" name="name" placeholder="Nama anggota baru" maxlength="40" required>
        <button class="btn" type="submit">Tambah</button>
      </form>
      <div class="section-title">Akun di HP ini</div>
      <div class="card">
        <button class="row" data-act="switch-me"><div class="grow"><div class="title">Ganti pengguna</div><div class="sub">Sekarang: ${esc(memberName(S.meId))}</div></div></button>
        <button class="row" data-act="open-pin"><div class="grow"><div class="title">Ganti PIN grup</div><div class="sub">Semua anggota harus pakai PIN baru</div></div></button>
        <button class="row" data-act="logout"><div class="grow"><div class="title neg">Keluar</div><div class="sub">Hapus PIN dari HP ini</div></div></button>
        ${demo ? '<button class="row" data-act="exit-demo"><div class="grow"><div class="title neg">Keluar mode demo</div><div class="sub">Hapus semua data demo</div></div></button>' : ''}
      </div>`;
  }

  // ----- Sheet -----
  function viewSheet() {
    let inner = '';
    if (S.sheet.type === 'tx') {
      const t = S.data.transactions.find((x) => x.id === S.sheet.id);
      if (!t) { S.sheet = null; return ''; }
      const lines = t.kind === 'split'
        ? t.shares.map((s) => `<div class="row"><div class="grow">${esc(memberName(s.member_id))}</div><div class="amt">${rp(s.amount)}</div></div>`).join('')
        : '';
      inner = `<h2>${esc(txTitle(t))}</h2>
        <div class="muted small" style="margin:0 4px">${KIND_LABEL[t.kind]} · ${esc(fmtDate(t.tx_date))}</div>
        <div class="hero" style="margin-top:12px"><div class="label">${txSub(t)}</div><div class="big">${rp(t.amount)}</div></div>
        ${lines ? `<div class="section-title">Pembagian</div><div class="card">${lines}</div>` : ''}
        <p class="muted small" style="margin:12px 4px 0">Dicatat ${esc(memberName(t.created_by))}, ${esc(fmtTime(t.created_at))}${
          t.updated_at !== t.created_at && t.updated_by ? `<br>Diubah ${esc(memberName(t.updated_by))}, ${esc(fmtTime(t.updated_at))}` : ''}</p>
        <div class="stack">
          <button class="btn" data-act="edit-tx" data-id="${t.id}">Edit</button>
          <button class="btn danger" data-act="delete-tx" data-id="${t.id}">Hapus</button>
          <button class="btn ghost" data-act="close-sheet">Tutup</button>
        </div>`;
    } else if (S.sheet.type === 'scan') {
      inner = viewScanSheet();
    } else if (S.sheet.type === 'pin') {
      inner = `<form data-form="change-pin" autocomplete="off">
        <h2>Ganti PIN grup</h2>
        <p class="muted small" style="margin:4px 4px 16px">Minimal 6 karakter. Kabari anggota lain PIN barunya.</p>
        <div class="field"><input class="input" type="password" name="p1" placeholder="PIN baru" autocomplete="new-password" required></div>
        <div class="field"><input class="input" type="password" name="p2" placeholder="Ulangi PIN baru" autocomplete="new-password" required></div>
        <div class="stack"><button class="btn" type="submit">Simpan PIN</button>
        <button class="btn ghost" type="button" data-act="close-sheet">Batal</button></div>
      </form>`;
    }
    return `<div class="sheet-backdrop" data-act="backdrop"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
  }

  // ----- Scan struk -----
  function scanAlloc() {
    const sc = S.scan;
    return allocateReceipt(sc.total, sc.items);
  }
  function scanPreview() {
    const sc = S.scan;
    const itemsSum = sc.items.reduce((a, it) => a + (it.price || 0), 0);
    const extra = sc.total - itemsSum;
    const unassigned = sc.items.filter((it) => it.price > 0 && !it.who.length).length;
    const lines = scanAlloc().map((s) => `<div class="row"><div class="grow">${esc(memberName(s.member_id))}</div><div class="amt">${rp(s.amount)}</div></div>`).join('');
    return `<p class="hint muted">Item ${rp(itemsSum)}${extra ? ` · ${extra > 0 ? 'pajak/service' : 'diskon'} ${rp(Math.abs(extra))} dibagi proporsional` : ''}</p>
      ${unassigned ? `<p class="hint neg">${unassigned} item belum dipilih orangnya.</p>` : ''}
      ${lines ? `<div class="card" style="margin-top:8px">${lines}</div>` : ''}`;
  }
  function viewScanSheet() {
    const sc = S.scan;
    const people = activeMembers();
    const items = sc.items.map((it, i) => `<div class="scan-item">
        <div class="scan-head"><span class="scan-name">${esc(it.name)}${it.qty > 1 ? ` <span class="muted">×${it.qty}</span>` : ''}</span>
          <input class="input scan-price" data-sf="price" data-i="${i}" inputmode="numeric" value="${fmtInput(it.price)}" aria-label="Harga ${esc(it.name)}"></div>
        <div class="chips sm">
          ${people.map((m) => `<button type="button" data-act="scan-who" data-i="${i}" data-id="${m.id}" aria-pressed="${it.who.includes(m.id)}">${esc(m.name)}</button>`).join('')}
          <button type="button" data-act="scan-all" data-i="${i}" class="chip-all">${it.who.length === people.length ? 'Kosong' : 'Semua'}</button>
        </div></div>`).join('');
    return `<h2>${esc(sc.merchant || 'Struk')}</h2>
      <p class="muted small" style="margin:4px 4px 12px">Tap nama orang yang ikut tiap item. Item bareng dibagi rata.</p>
      ${items || '<div class="empty">Tidak ada item terbaca. Isi total lalu bagi manual.</div>'}
      <div class="field" style="margin-top:16px"><label for="scan-total">Total struk</label>
        <div class="money-wrap"><span>Rp</span><input id="scan-total" class="input money" data-sf="total" inputmode="numeric" value="${fmtInput(sc.total)}"></div></div>
      <div id="scan-preview">${scanPreview()}</div>
      <div class="stack">
        <button class="btn" data-act="scan-apply">Pakai pembagian ini</button>
        <button class="btn ghost" data-act="close-sheet">Batal</button>
      </div>`;
  }

  function fileToJpegB64(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // Struk panjang & sempit: batasi lebar 1200px, tinggi sampai 4000px.
        const s = Math.min(1, 1200 / img.naturalWidth, 4000 / img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak bisa dibaca.')); };
      img.src = url;
    });
  }

  async function runScan(file) {
    if (S.scanning) return;
    S.scanning = true;
    render();
    try {
      const image = await fileToJpegB64(file);
      let res;
      try {
        res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: S.pin, image }),
        });
      } catch (_) {
        throw new Error('Gagal konek ke server scan.');
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        if (res.status === 404 || !data) throw new Error('Scan struk hanya jalan di versi yang sudah di-deploy ke Vercel.');
        if (data.error === 'PIN_SALAH') { lockOut('PIN salah atau sudah diganti.'); return; }
        throw new Error(data.error || 'Gagal membaca struk.');
      }
      if (!data.items.length && !data.total) throw new Error('Struk tidak terbaca, coba foto lebih dekat & terang.');
      S.scan = {
        merchant: data.merchant,
        date: data.date,
        total: data.total,
        items: data.items.map((it) => ({ name: it.name, qty: it.qty, price: it.price, who: [] })),
      };
      S.sheet = { type: 'scan' };
    } catch (e) {
      toast(e.message, true);
    } finally {
      S.scanning = false;
      render();
    }
  }

  function applyScan() {
    const sc = S.scan;
    if (!(sc.total > 0)) { toast('Isi total struk.', true); return; }
    if (sc.items.some((it) => it.price > 0 && !it.who.length)) { toast('Masih ada item yang belum dipilih orangnya.', true); return; }
    const shares = scanAlloc();
    if (!shares.length) { toast('Pilih orang untuk minimal satu item.', true); return; }
    const old = S.form || newForm('split');
    const f = Object.assign(newForm('split'), { id: old.id, payer: old.payer || S.meId });
    f.amount = sc.total;
    f.note = sc.merchant || old.note;
    if (sc.date) f.date = sc.date;
    f.mode = 'custom';
    f.participants = shares.map((s) => s.member_id);
    f.custom = {};
    for (const s of shares) f.custom[s.member_id] = s.amount;
    S.form = f;
    S.scan = null;
    S.sheet = null;
    render();
    toast('Cek "Dibayar oleh", lalu Simpan');
  }

  document.getElementById('scan-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) runScan(file);
  });

  // ---------- Events ----------
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act;
    const id = el.dataset.id ? Number(el.dataset.id) : null;
    if (a === 'backdrop' && e.target !== el) return;

    switch (a) {
      case 'tab':
        S.tab = el.dataset.tab;
        if (S.tab === 'tambah' && !S.form) S.form = newForm('split');
        render();
        window.scrollTo(0, 0);
        break;
      case 'refresh': load(true); break;
      case 'demo': store.set('ug_demo_mode', '1'); location.reload(); break;
      case 'exit-demo':
        if (!confirm('Keluar mode demo dan hapus semua data demo?')) break;
        window.UtangDemo.reset();
        store.set('ug_demo_mode', null);
        store.set('ug_pin', null);
        store.set('ug_me', null);
        location.reload();
        break;
      case 'pick-me': setMe(id); S.form = newForm('split'); render(); break;
      case 'switch-me': setMe(null); render(); break;
      case 'logout':
        if (confirm('Keluar dari HP ini? Kamu perlu masukkan PIN lagi.')) { setMe(null); lockOut(''); }
        break;

      case 'kind': {
        const k = el.dataset.kind;
        const old = S.form;
        S.form = Object.assign(newForm(k), { id: old.id, amount: old.amount, note: old.note, date: old.date });
        render();
        break;
      }
      case 'toggle-part': {
        const f = S.form;
        f.participants = f.participants.includes(id) ? f.participants.filter((x) => x !== id) : [...f.participants, id].sort((x, y) => x - y);
        render();
        break;
      }
      case 'toggle-all': {
        const f = S.form;
        const all = activeMembers().map((m) => m.id);
        f.participants = f.participants.length === all.length ? [] : all;
        render();
        break;
      }
      case 'mode': {
        const f = S.form;
        f.mode = el.dataset.mode;
        if (f.mode === 'custom' && !customSum(f) && f.amount) {
          for (const s of equalSplit(f.amount, f.participants)) f.custom[s.member_id] = s.amount;
        }
        render();
        break;
      }
      case 'cancel-edit': S.form = newForm('split'); S.tab = 'riwayat'; render(); break;

      case 'hist': S.histView = el.dataset.v; render(); break;
      case 'open-tx': S.sheet = { type: 'tx', id }; render(); break;
      case 'backdrop':
        if (S.sheet && S.sheet.type === 'scan') break; // jangan hilangkan pilihan karena salah tap
        S.sheet = null; render(); break;
      case 'close-sheet': S.sheet = null; S.scan = null; render(); break;
      case 'scan-who': {
        const it = S.scan.items[Number(el.dataset.i)];
        it.who = it.who.includes(id) ? it.who.filter((x) => x !== id) : [...it.who, id];
        rerenderSheet();
        break;
      }
      case 'scan-all': {
        const it = S.scan.items[Number(el.dataset.i)];
        const all = activeMembers().map((m) => m.id);
        it.who = it.who.length === all.length ? [] : all;
        rerenderSheet();
        break;
      }
      case 'scan-apply': applyScan(); break;
      case 'edit-tx': {
        const t = S.data.transactions.find((x) => x.id === id);
        if (!t) break;
        S.form = formFromTx(t);
        S.sheet = null;
        S.tab = 'tambah';
        render();
        window.scrollTo(0, 0);
        break;
      }
      case 'delete-tx':
        if (!confirm('Hapus transaksi ini? Tetap tercatat di log aktivitas.')) break;
        act(async () => {
          await rpc('delete_transaction', { p_actor: S.meId, p_id: id });
          S.sheet = null;
          if (S.form && S.form.id === id) S.form = newForm('split');
          toast('Transaksi dihapus');
          await load(true);
        });
        break;

      case 'settle': {
        const bal = computeBalances(members(), S.data.transactions);
        const t = simplify(bal)[Number(el.dataset.i)];
        if (!t) break;
        if (!confirm(memberName(t.from) + ' sudah bayar ' + rp(t.amount) + ' ke ' + memberName(t.to) + '?')) break;
        act(async () => {
          await rpc('save_transaction', {
            p_actor: S.meId, p_id: null, p_kind: 'settlement', p_payer: t.from, p_amount: t.amount,
            p_note: 'Pelunasan', p_date: today(), p_shares: [{ member_id: t.to, amount: t.amount }],
          });
          toast('Ditandai lunas');
          await load(true);
        });
        break;
      }

      case 'rename': {
        const m = members().find((x) => x.id === id);
        const name = prompt('Nama baru', m.name);
        if (name == null || name.trim() === m.name) break;
        act(async () => {
          await rpc('update_member', { p_actor: S.meId, p_id: id, p_name: name, p_active: m.active });
          toast('Nama diubah');
          await load(true);
        });
        break;
      }
      case 'toggle-active': {
        const m = members().find((x) => x.id === id);
        if (m.active && !confirm('Nonaktifkan ' + m.name + '? Riwayatnya tetap ada.')) break;
        act(async () => {
          await rpc('update_member', { p_actor: S.meId, p_id: id, p_name: m.name, p_active: !m.active });
          toast(m.active ? 'Dinonaktifkan' : 'Diaktifkan');
          await load(true);
        });
        break;
      }
      case 'open-pin': S.sheet = { type: 'pin' }; render(); break;
    }
  });

  // Render ulang isi sheet saja, posisi scroll sheet tetap.
  function rerenderSheet() {
    const sheet = document.querySelector('.sheet');
    if (!sheet) { render(); return; }
    const top = sheet.scrollTop;
    sheet.innerHTML = viewScanSheet();
    sheet.scrollTop = top;
  }

  function onFieldInput(e) {
    const el = e.target;
    const sf = el.dataset && el.dataset.sf;
    if (sf && S.scan) {
      const n = parseAmt(el.value);
      el.value = fmtInput(n);
      if (sf === 'total') S.scan.total = n;
      else S.scan.items[Number(el.dataset.i)].price = n;
      const p = document.getElementById('scan-preview');
      if (p) p.innerHTML = scanPreview();
      return;
    }
    const k = el.dataset && el.dataset.f;
    if (!k || !S.form) return;
    const f = S.form;
    if (k === 'amount' || k === 'custom') {
      const n = parseAmt(el.value);
      el.value = fmtInput(n);
      if (k === 'amount') f.amount = n;
      else f.custom[Number(el.dataset.id)] = n;
    } else if (k === 'note' || k === 'date') {
      f[k] = el.value;
    } else {
      f[k] = Number(el.value) || null;
    }
    const hint = document.getElementById('split-hint');
    if (hint) hint.innerHTML = splitHint(f);
  }
  root.addEventListener('input', onFieldInput);
  root.addEventListener('change', onFieldInput);

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.form;
    const fd = new FormData(form);

    if (kind === 'pin') {
      const pin = String(fd.get('pin') || '');
      if (!pin) return;
      S.pin = pin;
      S.gateError = '';
      act(async () => {
        try {
          S.data = await rpc('get_state');
        } catch (err) {
          if (err.message !== 'PIN_SALAH') { S.pin = null; S.gateError = err.message; render(); }
          return;
        }
        store.set('ug_pin', pin);
        const me = S.data.members.find((m) => m.id === S.meId);
        if (!me || !me.active) setMe(null);
        S.form = newForm('split');
        render();
      });
      return;
    }

    if (kind === 'first-member') {
      act(async () => {
        const id = await rpc('add_member', { p_actor: null, p_name: String(fd.get('name') || '') });
        setMe(id);
        await load(true);
        S.form = newForm('split');
        render();
      });
      return;
    }

    if (kind === 'add-member') {
      act(async () => {
        await rpc('add_member', { p_actor: S.meId, p_name: String(fd.get('name') || '') });
        toast('Anggota ditambah');
        await load(true);
      });
      return;
    }

    if (kind === 'change-pin') {
      const p1 = String(fd.get('p1') || '');
      const p2 = String(fd.get('p2') || '');
      if (p1 !== p2) { toast('PIN tidak sama', true); return; }
      if (p1.length < 6) { toast('PIN minimal 6 karakter', true); return; }
      act(async () => {
        await rpc('change_pin', { p_actor: S.meId, p_new_pin: p1 });
        S.pin = p1;
        store.set('ug_pin', p1);
        S.sheet = null;
        toast('PIN diganti');
        await load(true);
      });
      return;
    }

    if (kind === 'tx') {
      let payload;
      try { payload = buildPayload(S.form); }
      catch (err) { toast(err.message, true); return; }
      const editing = !!S.form.id;
      act(async () => {
        await rpc('save_transaction', payload);
        toast(editing ? 'Perubahan disimpan' : 'Tersimpan');
        S.form = newForm(editing ? 'split' : S.form.kind);
        S.tab = editing ? 'riwayat' : 'saldo';
        await load(true);
        window.scrollTo(0, 0);
      });
    }
  });

  // Sync saat app dibuka lagi (pindah dari app lain / unlock HP).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.pin && !S.sheet) load(true);
  });

  render();
  if (S.pin) load();
})();
