import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from './helpers/memory-store.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sincronização do catálogo APIBrasil', () => {
  it('importa o formato de /precos e resolve preços pelo módulo canônico', async () => {
    vi.stubEnv('APIBRASIL_CATALOG_URL', 'https://app.apibrasil.io/precos');
    vi.stubEnv('APIBRASIL_TOKEN', 'test-token');

    const payload = {
      error: false,
      status: 200,
      message: 'Você não possui um plano ativo.',
      total: 10,
      apis: [
        { service_name: 'dados-cadastrais', name: 'Cadastro de uma pessoa pelo CPF, com nome da mãe, RG, contatos, parentes e vínculos de trabalho. Retorna nome, data de nascimento, idade, sexo, situação cadastral e óbito', value: 12.9, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'receita-federal', name: 'Situação cadastral do CPF na Receita Federal e identificação do titular, com nome da mãe, sexo e idade', value: 12.9, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'analise-credito', name: 'Análise de crédito com score de crédito', value: 1, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'cnpj', endpoint: '/dados/cnpj/credits', name: 'Consulta CNPJ com razão social e endereço', value: 8.5, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'cpf-cnpj-pelo-telefone', name: 'Busca cadastros associados a um telefone', value: 6.4, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'fipe-placa', name: 'Dados técnicos da placa com Renavam e chassi', value: 2.8, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'roubo-furto-v2', name: 'Consulta pela placa com alertas de roubo ou furto e identificação do veículo', value: 12.5, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'cadastro-pf-basico', name: 'CPF com nome e situação cadastral', value: 0.08, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'placa-completa', name: 'Consulta placa completa com alertas de roubo e furto', value: 2.49, type: 'Api', mode: 'api', categories: [] },
        { service_name: 'telefones-socios', name: 'Telefones de sócios com CPF e CNPJ', value: 0.28, type: 'Api', mode: 'api', categories: [] },
      ],
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    const { syncApiCatalog } = await import('../supabase/functions/_shared/catalog.ts');
    const { resolvePrice } = await import('../supabase/functions/_shared/pricing.ts');
    const store = new MemoryStore();

    const result = await syncApiCatalog(store);
    expect(result.modules).toBe(5);
    expect(result.alerts).toEqual([]);

    const rows = await store.select('api_modules');
    expect(rows.map((row) => row.module_key).sort()).toEqual([
      'cnpj',
      'pf-cpf',
      'placa-basica',
      'placa-completa',
      'telefone',
    ]);

    const cpf = rows.find((row) => row.module_key === 'pf-cpf');
    expect(cpf?.endpoint).toBe('/consulta/cpf/credits');
    expect(cpf?.cost_cents).toBe(1290);
    expect((cpf?.payload_json as Record<string, unknown>).service_name).toBe('dados-cadastrais');

    const cnpj = rows.find((row) => row.module_key === 'cnpj');
    expect(cnpj?.endpoint).toBe('/dados/cnpj/credits');
    expect(cnpj?.cost_cents).toBe(850);

    const phone = rows.find((row) => row.module_key === 'telefone');
    expect(phone?.cost_cents).toBe(640);
    expect(phone?.endpoint).toBe('/consulta/cpf-cnpj-pelo-telefone/credits');
    expect((phone?.payload_json as Record<string, unknown>).service_name).toBe('cpf-cnpj-pelo-telefone');

    const basicPlate = rows.find((row) => row.module_key === 'placa-basica');
    const fullPlate = rows.find((row) => row.module_key === 'placa-completa');
    expect(basicPlate?.cost_cents).toBe(1250);
    expect(fullPlate?.cost_cents).toBe(1250);
    expect(fullPlate?.endpoint).toBe('/consulta/veiculos/credits');
    expect((basicPlate?.payload_json as Record<string, unknown>).service_name).toBe('roubo-furto-v2');
    expect((fullPlate?.payload_json as Record<string, unknown>).service_name).toBe('roubo-furto-v2');

    const price = await resolvePrice(store, 'PF', 'cpf', 'basic');
    expect(price.source).toBe('catalog');
    expect(price.costCents).toBe(1290);
    expect(price.priceCents).toBe(2580);
    expect(price.serviceName).toBe('dados-cadastrais');
  });
});
