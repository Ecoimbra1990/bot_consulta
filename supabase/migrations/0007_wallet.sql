alter table public.users
  add column if not exists wallet_balance_cents integer not null default 0;

alter table public.users drop constraint if exists users_telegram_id_key;

create table if not exists public.user_telegram_accounts (
  telegram_id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_telegram_accounts_user_id_idx
  on public.user_telegram_accounts (user_id);

insert into public.user_telegram_accounts (telegram_id, user_id, username)
select u.telegram_id::text, u.id, u.username
from public.users u
where u.telegram_id is not null
on conflict (telegram_id) do nothing;

alter table public.plans
  add column if not exists credit_cents integer not null default 0,
  add column if not exists kind text not null default 'package';

alter table public.subscriptions
  add column if not exists converted_at timestamptz,
  add column if not exists wallet_credit_cents integer;

alter table public.payments
  add column if not exists credit_cents integer not null default 0,
  add column if not exists telegram_chat_id bigint,
  add column if not exists kind text not null default 'pix';

alter table public.queries
  add column if not exists charged_cents integer not null default 0,
  add column if not exists module_key text;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('pending','paid','failed','manual','expired','refunded'));

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('credit','debit','refund','bonus','manual')),
  amount_cents integer not null,
  balance_after_cents integer not null,
  reference text unique,
  description text,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_created_idx
  on public.wallet_transactions (user_id, created_at desc);

create table if not exists public.api_modules (
  module_key text primary key,
  label text,
  endpoint text,
  cost_cents integer not null default 0,
  balance_cents integer,
  source text default 'apibrasil',
  payload_json jsonb,
  updated_at timestamptz default now()
);

create index if not exists api_modules_endpoint_idx
  on public.api_modules (endpoint);

create or replace function public.wallet_credit(
  p_user_id uuid,
  p_amount_cents integer,
  p_reference text,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_kind text default 'credit'
) returns integer language plpgsql as $$
declare
  v_balance integer;
begin
  if p_amount_cents <= 0 then
    raise exception 'valor de crédito inválido';
  end if;
  if p_kind not in ('credit','refund','bonus','manual') then
    raise exception 'tipo de crédito inválido';
  end if;

  select u.wallet_balance_cents into v_balance from public.users u where u.id = p_user_id;
  if v_balance is null then
    raise exception 'usuário não encontrado';
  end if;
  if exists (select 1 from public.wallet_transactions wt where wt.reference = p_reference) then
    return v_balance;
  end if;

  update public.users
    set wallet_balance_cents = wallet_balance_cents + p_amount_cents
    where id = p_user_id
    returning wallet_balance_cents into v_balance;

  insert into public.wallet_transactions
    (user_id, kind, amount_cents, balance_after_cents, reference, description, metadata_json)
  values
    (p_user_id, p_kind, p_amount_cents, v_balance, p_reference, p_description, p_metadata);

  return v_balance;
end;
$$;

create or replace function public.wallet_debit(
  p_user_id uuid,
  p_amount_cents integer,
  p_reference text,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
) returns integer language plpgsql as $$
declare
  v_balance integer;
begin
  if p_amount_cents <= 0 then
    raise exception 'valor de débito inválido';
  end if;

  select u.wallet_balance_cents into v_balance from public.users u where u.id = p_user_id;
  if v_balance is null then
    raise exception 'usuário não encontrado';
  end if;
  if exists (select 1 from public.wallet_transactions wt where wt.reference = p_reference) then
    return v_balance;
  end if;

  update public.users
    set wallet_balance_cents = wallet_balance_cents - p_amount_cents
    where id = p_user_id and wallet_balance_cents >= p_amount_cents
    returning wallet_balance_cents into v_balance;

  if not found or v_balance is null then
    raise exception 'saldo insuficiente';
  end if;

  insert into public.wallet_transactions
    (user_id, kind, amount_cents, balance_after_cents, reference, description, metadata_json)
  values
    (p_user_id, 'debit', -p_amount_cents, v_balance, p_reference, p_description, p_metadata);

  return v_balance;
end;
$$;

do $$
declare
  s record;
  v_credit integer;
  v_days numeric;
begin
  for s in
    select su.id, su.user_id, su.ends_at,
           coalesce(pl.price_cents, 0) as plan_price_cents,
           coalesce(pl.period_days, 30) as plan_period_days
    from public.subscriptions su
    left join public.plans pl on pl.id = su.plan_id
    where su.status = 'active' and su.ends_at > now()
  loop
    v_days := greatest(extract(epoch from (s.ends_at - now())) / 86400.0, 0);
    v_credit := greatest(1, round(s.plan_price_cents * v_days / nullif(s.plan_period_days, 0))::integer);
    perform public.wallet_credit(
      s.user_id,
      v_credit,
      'subscription:' || s.id::text,
      'Créditos convertidos da assinatura',
      jsonb_build_object('subscription_id', s.id, 'days', v_days),
      'manual'
    );
    update public.subscriptions
      set status = 'canceled', converted_at = now(), wallet_credit_cents = v_credit
      where id = s.id;
  end loop;
end $$;

update public.plans
  set active = false, kind = 'legacy'
  where name = 'Mensal';

insert into public.plans (name, price_cents, credit_cents, period_days, active, kind)
select 'Básico', 1500, 1500, 0, true, 'package'
where not exists (select 1 from public.plans where name = 'Básico');

insert into public.plans (name, price_cents, credit_cents, period_days, active, kind)
select 'Operacional', 3000, 3500, 0, true, 'package'
where not exists (select 1 from public.plans where name = 'Operacional');

insert into public.plans (name, price_cents, credit_cents, period_days, active, kind)
select 'Profissional', 5000, 6500, 0, true, 'package'
where not exists (select 1 from public.plans where name = 'Profissional');

update public.plans
  set price_cents = 1500, credit_cents = 1500, period_days = 0, active = true, kind = 'package'
  where name = 'Básico';
update public.plans
  set price_cents = 3000, credit_cents = 3500, period_days = 0, active = true, kind = 'package'
  where name = 'Operacional';
update public.plans
  set price_cents = 5000, credit_cents = 6500, period_days = 0, active = true, kind = 'package'
  where name = 'Profissional';

update public.app_settings
  set query_cache_ttl_seconds = 86400, updated_at = now()
  where id = 'main';
