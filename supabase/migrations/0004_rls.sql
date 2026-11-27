alter table public.users enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.queries enable row level security;
alter table public.query_results enable row level security;
alter table public.query_cache enable row level security;
alter table public.audit_logs enable row level security;
alter table public.bot_sessions enable row level security;
alter table public.dsr_requests enable row level security;
alter table public.rate_limits enable row level security;
alter table public.app_settings enable row level security;
alter table public.job_runs enable row level security;

revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on public.users, public.plans, public.subscriptions, public.payments, public.queries, public.query_results, public.dsr_requests, public.app_settings, public.job_runs to authenticated;
grant select on public.audit_logs to authenticated;
grant insert on public.audit_logs to authenticated;

grant usage on schema public to authenticated, anon;

revoke all on function public.is_admin() from public;
revoke all on function public.rate_limit_check(text, text, integer) from public;
revoke all on function public.expire_subscriptions() from public;
revoke all on function public.expire_subscriptions() from anon, authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.rate_limit_check(text, text, integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.is_admin() to service_role;
    grant execute on function public.rate_limit_check(text, text, integer) to service_role;
    grant execute on function public.expire_subscriptions() to service_role;
  end if;
end
$$;

create policy admin_full_users on public.users for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_full_plans on public.plans for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_full_subscriptions on public.subscriptions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_full_payments on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_full_queries on public.queries for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_full_query_results on public.query_results for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_full_dsr_requests on public.dsr_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_full_app_settings on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_full_job_runs on public.job_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy admin_read_audit_logs on public.audit_logs for select to authenticated using (public.is_admin());
create policy admin_insert_audit_logs on public.audit_logs for insert to authenticated with check (public.is_admin());
