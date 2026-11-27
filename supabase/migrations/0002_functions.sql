create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
$$;

create or replace function public.rate_limit_check(p_scope text, p_identity text, p_limit integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bucket text;
  v_id text;
  v_count integer;
begin
  v_bucket := to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI');
  v_id := p_scope || ':' || p_identity || ':' || v_bucket;

  delete from public.rate_limits
  where id = v_id and expires_at < now();

  insert into public.rate_limits as rl (id, scope, identity, count, expires_at)
  values (v_id, p_scope, p_identity, 1, now() + interval '2 minutes')
  on conflict (id) do update
    set count = rl.count + 1,
        scope = excluded.scope,
        identity = excluded.identity,
        expires_at = now() + interval '2 minutes'
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$$;

create or replace function public.expire_subscriptions()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.subscriptions
  set status = 'expired'
  where status = 'active' and ends_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before insert or update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before insert or update on public.app_settings
for each row execute function public.set_updated_at();
