import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from './helpers/memory-store.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sincronização do catálogo de consultas', () => {
  it('importa /datasets da Verifica Online, /precos da APIBrasil e resolve preços pelo módulo canônico', async () => {
    vi.stubEnv('APIBRASIL_CATALOG_URL', 'https://app.apibrasil.io/precos');
    vi.stubEnv('APIBRASIL_TOKEN', 'test-token');
    vi.stubEnv('VERIFICA_ONLINE_API_KEY', 'voa_test_key');
    vi.stubEnv('VERIFICA_ONLINE_API_BASE', 'https://api.verifica-online.test');

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

    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (String(input).endsWith('/datasets')) {
        return new Response(JSON.stringify({
          datasets: [
            { key: 'cpf_dados_completos', enabled: true, price_cents: 499, name: 'CPF completo' },
            { key: 'cnpj_dados_basicos', enabled: true, price_cents: 299, name: 'CNPJ' },
            { key: 'consulta_placa', enabled: true, price_cents: 199, name: 'Placa' },
            { key: 'veicular_completa', enabled: true, price_cents: 399, name: 'Placa completa' },
            { key: 'telefone', enabled: true, price_cents: 99, name: 'Sem uso' },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    }));

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
    expect(cpf?.source).toBe('apibrasil');
    expect((cpf?.payload_json as Record<string, unknown>).service_name).toBe('dados-cadastrais');

    const cnpj = rows.find((row) => row.module_key === 'cnpj');
    expect(cnpj?.endpoint).toBe('/datasets/cnpj_dados_basicos/queries');
    expect(cnpj?.cost_cents).toBe(299);
    expect(cnpj?.source).toBe('verifica-online');

    const phone = rows.find((row) => row.module_key === 'telefone');
    expect(phone?.cost_cents).toBe(640);
    expect(phone?.endpoint).toBe('/consulta/cpf-cnpj-pelo-telefone/credits');
    expect(phone?.source).toBe('apibrasil');
    expect((phone?.payload_json as Record<string, unknown>).service_name).toBe('cpf-cnpj-pelo-telefone');

    const basicPlate = rows.find((row) => row.module_key === 'placa-basica');
    const fullPlate = rows.find((row) => row.module_key === 'placa-completa');
    expect(basicPlate?.cost_cents).toBe(199);
    expect(fullPlate?.cost_cents).toBe(399);
    expect(basicPlate?.endpoint).toBe('/datasets/consulta_placa/queries');
    expect(fullPlate?.endpoint).toBe('/datasets/veicular_completa/queries');
    expect(basicPlate?.source).toBe('verifica-online');
    expect(fullPlate?.source).toBe('verifica-online');

    const price = await resolvePrice(store, 'PF', 'cpf', 'basic');
    expect(price.source).toBe('catalog');
    expect(price.provider).toBe('apibrasil');
    expect(price.costCents).toBe(1290);
    expect(price.priceCents).toBe(2580);
    expect(price.serviceName).toBe('dados-cadastrais');
    expect(price.datasetKey).toBe('');
  });

  it('bloqueia módulo sem custo catalogado quando o catálogo da APIBrasil está ativo', async () => {
    vi.stubEnv('APIBRASIL_CATALOG_URL', 'https://app.apibrasil.io/precos');
    const { assertSafeMargin, resolvePrice } = await import('../supabase/functions/_shared/pricing.ts');

    const price = await resolvePrice(new MemoryStore(), 'PF', 'cpf', 'basic');

    expect(price.provider).toBe('apibrasil');
    expect(price.source).toBe('fallback');
    expect(() => assertSafeMargin(price)).toThrow(/sem custo catalogado/);
  });
});
