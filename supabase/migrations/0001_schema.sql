create table public.users (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  telegram_id bigint unique,
  username text,
  name text,
  email text unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  password_hash text,
  role text not null default 'user' check (role in ('admin','user')),
  status text not null default 'pending' check (status in ('active','blocked','pending')),
  consent_version text,
  consent_at timestamptz,
  legal_basis text,
  anonymized_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  price_cents integer not null,
  period_days integer not null,
  active boolean not null default true,
  queries_per_day integer,
  created_at timestamptz default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid not null references public.users(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  source text check (source in ('manual','mercadopago')),
  status text not null default 'active' check (status in ('active','past_due','canceled','expired')),
  starts_at timestamptz,
  ends_at timestamptz,
  external_ref text unique,
  payment_id text,
  created_at timestamptz default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid references public.users(id) on delete set null,
  plan_id uuid references public.plans(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text,
  amount_cents integer default 0,
  status text not null default 'pending' check (status in ('pending','paid','failed','manual')),
  external_id text unique,
  external_reference text unique,
  preference_id text,
  checkout_url text,
  mercadopago_payment_id text,
  payload_json jsonb,
  expires_at timestamptz,
  updated_at timestamptz,
  error text,
  created_at timestamptz default now()
);

create table public.queries (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid references public.users(id) on delete set null,
  entity text not null,
  key_type text not null,
  key_hash text not null,
  key_masked text,
  provider text,
  status text not null check (status in ('pending','completed','failed')),
  cost_cents integer default 0,
  error text,
  created_at timestamptz default now()
);

create table public.query_results (
  query_id uuid primary key references public.queries(id) on delete cascade,
  raw_encrypted text,
  normalized_json jsonb,
  fetched_at timestamptz
);

create table public.query_cache (
  key_hash text primary key,
  entity text,
  key_type text,
  raw_encrypted text,
  normalized_json jsonb,
  is_mock boolean default false,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata_json jsonb,
  created_at timestamptz default now()
);

create table public.bot_sessions (
  id text primary key,
  telegram_id bigint,
  state text,
  data jsonb,
  updated_at timestamptz default now()
);

create table public.dsr_requests (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid references public.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','done','rejected')),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now()
);

create table public.rate_limits (
  id text primary key,
  scope text not null,
  identity text not null,
  count integer not null default 0,
  expires_at timestamptz
);

create table public.app_settings (
  id text primary key default 'main',
  query_cache_ttl_seconds integer default 300,
  raw_retention_days integer default 90,
  queries_per_minute integer default 10,
  consent_version text default 'v1',
  updated_at timestamptz default now()
);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null,
  detail jsonb,
  created_at timestamptz default now()
);
