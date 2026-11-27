insert into public.app_settings (id) values ('main') on conflict do nothing;

insert into public.plans (name, price_cents, period_days, active, queries_per_day)
values ('Mensal', 4990, 30, true, 100)
on conflict do nothing;
