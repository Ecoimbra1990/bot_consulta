alter table public.api_modules
  add column if not exists entity text,
  add column if not exists key_type text,
  add column if not exists mode text not null default 'basic',
  add column if not exists dataset_key text,
  add column if not exists service_name text,
  add column if not exists active boolean not null default true,
  add column if not exists managed_by text not null default 'catalog',
  add column if not exists menu_order integer not null default 100;

alter table public.api_modules drop constraint if exists api_modules_mode_check;
alter table public.api_modules add constraint api_modules_mode_check check (mode in ('basic', 'full'));

create index if not exists api_modules_active_idx on public.api_modules (active, menu_order);

do $$
begin
  update public.api_modules
     set entity = case module_key
       when 'pf-cpf' then 'PF'
       when 'cnpj' then 'EMPRESA'
       when 'telefone' then 'TELEFONE'
       when 'placa-basica' then 'VEICULO'
       when 'placa-completa' then 'VEICULO'
       when 'frota-cpf' then 'VEICULO_FROTA'
       when 'renavam' then 'VEICULO'
     end
   where entity is null and module_key in ('pf-cpf', 'cnpj', 'telefone', 'placa-basica', 'placa-completa', 'frota-cpf', 'renavam');

  update public.api_modules
     set key_type = case module_key
       when 'pf-cpf' then 'cpf'
       when 'cnpj' then 'cnpj'
       when 'telefone' then 'telefone'
       when 'placa-basica' then 'placa'
       when 'placa-completa' then 'placa'
       when 'frota-cpf' then 'cpf'
       when 'renavam' then 'renavam'
     end
   where key_type is null and module_key in ('pf-cpf', 'cnpj', 'telefone', 'placa-basica', 'placa-completa', 'frota-cpf', 'renavam');

  update public.api_modules
     set mode = 'full', dataset_key = 'veicular_completa'
   where module_key = 'placa-completa';

  update public.api_modules
     set dataset_key = case module_key
       when 'pf-cpf' then 'cpf_dados_completos'
       when 'cnpj' then 'cnpj_dados_basicos'
       when 'placa-basica' then 'consulta_placa'
     end
   where dataset_key is null and module_key in ('pf-cpf', 'cnpj', 'placa-basica');

  update public.api_modules
     set service_name = case module_key
       when 'telefone' then 'cpf-cnpj-pelo-telefone'
       when 'frota-cpf' then 'frota-pf'
       when 'renavam' then 'frota-pf'
     end
   where service_name is null and module_key in ('telefone', 'frota-cpf', 'renavam');
end
$$;
