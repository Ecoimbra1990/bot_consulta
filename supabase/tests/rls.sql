begin;
select plan(3);

insert into public.users (legacy_id, telegram_id, username, name)
values ('rls-test-user', 999999999, 'rls_test', 'RLS Test')
on conflict do nothing;

grant select on public.users to anon;
revoke all on public.query_cache from public;

set role anon;
select is((select count(*)::integer from public.users), 0, 'anon sees no users');
reset role;

set role authenticated;
select throws_ok($$select 1 from public.query_cache$$, '42501', null, 'authenticated cannot read query_cache');
select is(public.is_admin(), false, 'non-admin jwt is not admin');
reset role;

select * from finish();
rollback;
