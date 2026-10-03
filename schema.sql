-- =====================================================================
-- Utang Grup — skema Supabase
-- Jalankan SELURUH file ini di Supabase > SQL Editor > New query > Run.
-- Aman dijalankan ulang (idempotent) kecuali bagian SET PIN di paling bawah
-- yang akan me-reset PIN.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabel ----------
create table if not exists public.settings (
  id       int primary key default 1 check (id = 1),
  pin_hash text not null
);

create table if not exists public.members (
  id         bigint generated always as identity primary key,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists members_name_uq on public.members (lower(name));

create table if not exists public.transactions (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('split', 'debt', 'settlement')),
  payer_id   bigint not null references public.members (id),
  amount     bigint not null check (amount > 0),
  note       text not null default '',
  tx_date    date not null default current_date,
  created_by bigint references public.members (id),
  updated_by bigint references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Saldo: payer += amount, setiap share.member -= share.amount
--   split      : payer bayar bill, shares = bagian tiap orang
--   debt       : "B utang ke A"  -> payer A, share B
--   settlement : "B bayar ke A"  -> payer B, share A
create table if not exists public.shares (
  transaction_id bigint not null references public.transactions (id) on delete cascade,
  member_id      bigint not null references public.members (id),
  amount         bigint not null check (amount > 0),
  primary key (transaction_id, member_id)
);

create table if not exists public.activity_log (
  id             bigint generated always as identity primary key,
  actor_id       bigint references public.members (id),
  action         text not null,
  transaction_id bigint,
  before         jsonb,
  after          jsonb,
  at             timestamptz not null default now()
);

-- Foto nota (JPEG base64, sudah dikompres di HP), maksimal satu per transaksi.
create table if not exists public.receipts (
  transaction_id bigint primary key references public.transactions (id) on delete cascade,
  image          text not null,
  created_at     timestamptz not null default now()
);

-- RLS aktif tanpa policy = anon key tidak bisa akses tabel langsung.
alter table public.settings     enable row level security;
alter table public.members      enable row level security;
alter table public.transactions enable row level security;
alter table public.shares       enable row level security;
alter table public.activity_log enable row level security;
alter table public.receipts     enable row level security;

revoke all on public.settings, public.members, public.transactions,
              public.shares, public.activity_log, public.receipts
  from anon, authenticated;

-- ---------- Helper internal ----------
create or replace function public.assert_pin(p_pin text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_hash text;
begin
  select pin_hash into v_hash from settings where id = 1;
  -- PIN placeholder tidak pernah boleh dipakai login.
  -- (ditulis terpisah supaya placeholder cuma muncul sekali di file ini)
  if v_hash is null or extensions.crypt('GANTI-' || 'PIN-INI', v_hash) = v_hash then
    raise exception 'PIN_BELUM_DISET';
  end if;
  if p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    raise exception 'PIN_SALAH';
  end if;
end $$;

create or replace function public.assert_actor(p_actor bigint)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if not exists (select 1 from members where id = p_actor and active) then
    raise exception 'PENGGUNA_TIDAK_DIKENAL';
  end if;
end $$;

create or replace function public.member_balance(p_id bigint)
returns bigint language sql security definer
set search_path = public, extensions as $$
  select
    coalesce((select sum(t.amount) from transactions t
               where t.deleted_at is null and t.payer_id = p_id), 0)
  - coalesce((select sum(s.amount) from shares s
               join transactions t on t.id = s.transaction_id
               where t.deleted_at is null and s.member_id = p_id), 0)
$$;

create or replace function public.tx_json(p_id bigint)
returns jsonb language sql security definer
set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'payer_id', t.payer_id, 'amount', t.amount,
    'note', t.note, 'tx_date', t.tx_date,
    'created_by', t.created_by, 'updated_by', t.updated_by,
    'created_at', t.created_at, 'updated_at', t.updated_at,
    'shares', coalesce((select jsonb_agg(jsonb_build_object('member_id', s.member_id, 'amount', s.amount)
                                         order by s.member_id)
                          from shares s where s.transaction_id = t.id), '[]'::jsonb))
  from transactions t
  where t.id = p_id and t.deleted_at is null
$$;

-- ---------- RPC publik (semua wajib PIN) ----------
-- Dipakai Vercel function /api/scan untuk memastikan yang scan anggota grup.
create or replace function public.check_pin(p_pin text)
returns boolean language plpgsql security definer
set search_path = public, extensions as $$
begin
  perform assert_pin(p_pin);
  return true;
end $$;

create or replace function public.get_state(p_pin text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
begin
  perform assert_pin(p_pin);
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'active', m.active)
                                          order by m.id)
                           from members m), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(tx_json(t.id) order by t.tx_date desc, t.id desc)
                                from transactions t where t.deleted_at is null), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(to_jsonb(l) order by l.id desc)
                       from (select * from activity_log order by id desc limit 200) l), '[]'::jsonb),
    'receipt_ids', coalesce((select jsonb_agg(r.transaction_id)
                               from receipts r join transactions t on t.id = r.transaction_id
                              where t.deleted_at is null), '[]'::jsonb)
  );
end $$;

-- p_image kosong/null = hapus nota.
create or replace function public.set_receipt(p_pin text, p_actor bigint, p_tx_id bigint, p_image text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  perform assert_pin(p_pin);
  perform assert_actor(p_actor);
  if not exists (select 1 from transactions where id = p_tx_id and deleted_at is null) then
    raise exception 'Transaksi tidak ditemukan';
  end if;
  if coalesce(p_image, '') = '' then
    delete from receipts where transaction_id = p_tx_id;
    if found then
      insert into activity_log (actor_id, action, transaction_id) values (p_actor, 'receipt_remove', p_tx_id);
    end if;
    return;
  end if;
  if length(p_image) > 1500000 then raise exception 'Foto nota terlalu besar'; end if;
  if p_image !~ '^[A-Za-z0-9+/=]+$' then raise exception 'Format foto nota tidak valid'; end if;
  insert into receipts (transaction_id, image) values (p_tx_id, p_image)
  on conflict (transaction_id) do update set image = excluded.image, created_at = now();
  insert into activity_log (actor_id, action, transaction_id) values (p_actor, 'receipt_set', p_tx_id);
end $$;

create or replace function public.get_receipt(p_pin text, p_tx_id bigint)
returns text language plpgsql security definer
set search_path = public, extensions as $$
begin
  perform assert_pin(p_pin);
  return (select image from receipts where transaction_id = p_tx_id);
end $$;

create or replace function public.add_member(p_pin text, p_actor bigint, p_name text)
returns bigint language plpgsql security definer
set search_path = public, extensions as $$
declare v_id bigint; v_name text := btrim(coalesce(p_name, ''));
begin
  perform assert_pin(p_pin);
  -- Anggota pertama boleh ditambah tanpa actor (belum ada yang bisa dipilih).
  if exists (select 1 from members) then
    perform assert_actor(p_actor);
  else
    p_actor := null;
  end if;
  if v_name = '' or length(v_name) > 40 then
    raise exception 'Nama wajib diisi (maks 40 karakter)';
  end if;
  if exists (select 1 from members where lower(name) = lower(v_name)) then
    raise exception 'Nama "%" sudah ada', v_name;
  end if;
  insert into members (name) values (v_name) returning id into v_id;
  insert into activity_log (actor_id, action, after)
    values (p_actor, 'member_add', jsonb_build_object('id', v_id, 'name', v_name));
  return v_id;
end $$;

create or replace function public.update_member(p_pin text, p_actor bigint, p_id bigint, p_name text, p_active boolean)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_old members%rowtype; v_name text := btrim(coalesce(p_name, ''));
begin
  perform assert_pin(p_pin);
  perform assert_actor(p_actor);
  select * into v_old from members where id = p_id;
  if not found then raise exception 'Anggota tidak ditemukan'; end if;
  if v_name = '' or length(v_name) > 40 then
    raise exception 'Nama wajib diisi (maks 40 karakter)';
  end if;
  if exists (select 1 from members where lower(name) = lower(v_name) and id <> p_id) then
    raise exception 'Nama "%" sudah ada', v_name;
  end if;
  if v_old.active and not p_active then
    if member_balance(p_id) <> 0 then
      raise exception 'Saldo % belum nol, lunasi dulu sebelum dinonaktifkan', v_old.name;
    end if;
    if p_id = p_actor then
      raise exception 'Tidak bisa menonaktifkan diri sendiri';
    end if;
  end if;
  update members set name = v_name, active = p_active where id = p_id;
  insert into activity_log (actor_id, action, before, after)
    values (p_actor, 'member_update',
            jsonb_build_object('id', p_id, 'name', v_old.name, 'active', v_old.active),
            jsonb_build_object('id', p_id, 'name', v_name, 'active', p_active));
end $$;

create or replace function public.save_transaction(
  p_pin text, p_actor bigint, p_id bigint, p_kind text, p_payer bigint,
  p_amount bigint, p_note text, p_date date, p_shares jsonb)
returns bigint language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_id bigint; v_sum bigint; v_count int; v_before jsonb;
begin
  perform assert_pin(p_pin);
  perform assert_actor(p_actor);

  if p_kind not in ('split', 'debt', 'settlement') then
    raise exception 'Jenis transaksi tidak valid';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Jumlah harus lebih dari 0';
  end if;
  if not exists (select 1 from members where id = p_payer) then
    raise exception 'Pembayar tidak ditemukan';
  end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' then
    raise exception 'Data pembagian tidak valid';
  end if;

  select count(*), coalesce(sum((e->>'amount')::bigint), 0)
    into v_count, v_sum
    from jsonb_array_elements(p_shares) e
   where (e->>'amount')::bigint > 0;

  if v_count = 0 then raise exception 'Pilih minimal satu orang'; end if;
  if exists (select 1 from jsonb_array_elements(p_shares) e
              where (e->>'amount')::bigint < 0
                 or not exists (select 1 from members m where m.id = (e->>'member_id')::bigint)) then
    raise exception 'Data pembagian tidak valid';
  end if;
  if v_sum <> p_amount then
    raise exception 'Total pembagian (%) tidak sama dengan jumlah (%)', v_sum, p_amount;
  end if;
  if p_kind in ('debt', 'settlement') then
    if v_count <> 1 then raise exception 'Utang/pelunasan harus ke tepat satu orang'; end if;
    if exists (select 1 from jsonb_array_elements(p_shares) e
                where (e->>'member_id')::bigint = p_payer and (e->>'amount')::bigint > 0) then
      raise exception 'Dua orangnya tidak boleh sama';
    end if;
  end if;

  if p_id is null then
    insert into transactions (kind, payer_id, amount, note, tx_date, created_by, updated_by)
    values (p_kind, p_payer, p_amount, btrim(coalesce(p_note, '')),
            coalesce(p_date, current_date), p_actor, p_actor)
    returning id into v_id;
  else
    v_before := tx_json(p_id);
    if v_before is null then raise exception 'Transaksi tidak ditemukan'; end if;
    update transactions
       set kind = p_kind, payer_id = p_payer, amount = p_amount,
           note = btrim(coalesce(p_note, '')), tx_date = coalesce(p_date, tx_date),
           updated_by = p_actor, updated_at = now()
     where id = p_id;
    delete from shares where transaction_id = p_id;
    v_id := p_id;
  end if;

  insert into shares (transaction_id, member_id, amount)
  select v_id, (e->>'member_id')::bigint, (e->>'amount')::bigint
    from jsonb_array_elements(p_shares) e
   where (e->>'amount')::bigint > 0;

  insert into activity_log (actor_id, action, transaction_id, before, after)
  values (p_actor, case when p_id is null then 'tx_create' else 'tx_update' end,
          v_id, v_before, tx_json(v_id));
  return v_id;
end $$;

create or replace function public.delete_transaction(p_pin text, p_actor bigint, p_id bigint)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_before jsonb;
begin
  perform assert_pin(p_pin);
  perform assert_actor(p_actor);
  v_before := tx_json(p_id);
  if v_before is null then raise exception 'Transaksi tidak ditemukan'; end if;
  update transactions set deleted_at = now(), updated_by = p_actor, updated_at = now() where id = p_id;
  insert into activity_log (actor_id, action, transaction_id, before)
    values (p_actor, 'tx_delete', p_id, v_before);
end $$;

create or replace function public.change_pin(p_pin text, p_actor bigint, p_new_pin text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  perform assert_pin(p_pin);
  perform assert_actor(p_actor);
  if p_new_pin is null or length(p_new_pin) < 6 then
    raise exception 'PIN baru minimal 6 karakter';
  end if;
  update settings set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')) where id = 1;
  insert into activity_log (actor_id, action) values (p_actor, 'pin_change');
end $$;

-- ---------- Hak akses fungsi ----------
revoke execute on function
  public.assert_pin(text), public.assert_actor(bigint),
  public.member_balance(bigint), public.tx_json(bigint),
  public.check_pin(text),
  public.get_state(text), public.add_member(text, bigint, text),
  public.update_member(text, bigint, bigint, text, boolean),
  public.save_transaction(text, bigint, bigint, text, bigint, bigint, text, date, jsonb),
  public.delete_transaction(text, bigint, bigint),
  public.change_pin(text, bigint, text),
  public.set_receipt(text, bigint, bigint, text), public.get_receipt(text, bigint)
  from public, anon, authenticated;

grant execute on function
  public.check_pin(text),
  public.get_state(text), public.add_member(text, bigint, text),
  public.update_member(text, bigint, bigint, text, boolean),
  public.save_transaction(text, bigint, bigint, text, bigint, bigint, text, date, jsonb),
  public.delete_transaction(text, bigint, bigint),
  public.change_pin(text, bigint, text),
  public.set_receipt(text, bigint, bigint, text), public.get_receipt(text, bigint)
  to anon, authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- SET PIN GRUP: ganti placeholder di bawah dengan PIN kamu (min 6 karakter)
-- HANYA di SQL Editor Supabase. JANGAN simpan PIN asli di file ini.
-- Selama placeholder belum diganti, login akan ditolak.
-- Menjalankan ulang baris ini = reset PIN.
-- =====================================================================
insert into public.settings (id, pin_hash)
values (1, extensions.crypt('GANTI-PIN-INI', extensions.gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash;
