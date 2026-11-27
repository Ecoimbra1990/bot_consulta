alter table public.query_cache
  add column if not exists module_key text;

notify pgrst, 'reload schema';
