alter table public.payments
  add column if not exists qr_code text,
  add column if not exists qr_code_base64 text;

notify pgrst, 'reload schema';
