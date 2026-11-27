update public.api_modules
   set source = 'apibrasil',
       endpoint = '/consulta/cpf/credits',
       service_name = 'dados-cadastrais',
       dataset_key = null,
       cost_cents = 34,
       payload_json = coalesce(payload_json, '{}'::jsonb) || '{"service_name":"dados-cadastrais"}'::jsonb,
       updated_at = now()
 where module_key = 'pf-cpf';

delete from public.query_cache
 where entity = 'PF'
   and key_type = 'cpf';
