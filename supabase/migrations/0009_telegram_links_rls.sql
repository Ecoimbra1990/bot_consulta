alter table public.user_telegram_accounts enable row level security;

drop policy if exists admin_full_user_telegram_accounts on public.user_telegram_accounts;
create policy admin_full_user_telegram_accounts on public.user_telegram_accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.user_telegram_accounts to authenticated;

create or replace function public.link_telegram_account(
  p_telegram_id text,
  p_user_id uuid,
  p_username text default null
) returns void language plpgsql as $$
begin
  insert into public.user_telegram_accounts (telegram_id, user_id, username)
  values (p_telegram_id, p_user_id, p_username)
  on conflict (telegram_id) do update
    set user_id = excluded.user_id,
        username = coalesce(excluded.username, public.user_telegram_accounts.username),
        updated_at = now();
end;
$$;
