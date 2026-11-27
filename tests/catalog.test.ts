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
      total: 6,
      apis: [
        { search: '11111111-1111-4111-8111-111111111111', service_name: 'cpf', name: 'Consulta CPF', value: 12.9, type: 'Api', mode: 'api', categories: [] },
        { search: '22222222-2222-4222-8222-222222222222', service_name: 'cpf', name: 'CPF Básico', value: 9.9, type: 'Api', mode: 'api', categories: [] },
        { search: '33333333-3333-4333-8333-333333333333', service_name: 'cnpj', name: 'Consulta CNPJ', value: 8.5, type: 'Api', mode: 'api', categories: [] },
        { search: '44444444-4444-4444-8444-444444444444', service_name: 'telefone', name: 'Consulta Telefone', value: 6.4, type: 'Api', mode: 'api', categories: [] },
        { search: '55555555-5555-4555-8555-555555555555', service_name: 'veiculos', name: 'Dados técnicos da placa com Renavam e chassi', value: 2.8, type: 'Api', mode: 'api', categories: [] },
        { search: '66666666-6666-4666-8666-666666666666', service_name: 'veiculos', name: 'Consulta pela placa com alertas de roubo ou furto', value: 43.78, type: 'Api', mode: 'api', categories: [] },
      ],
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    const { syncApiCatalog } = await import('../supabase/functions/_shared/catalog.ts');
    const { resolvePrice } = await import('../supabase/functions/_shared/pricing.ts');
    const store = new MemoryStore();

    const result = await syncApiCatalog(store);
    expect(result.modules).toBe(5);
    expect(result.alerts.some((alert) => alert.includes('Você não possui um plano ativo'))).toBe(true);

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

    const basicPlate = rows.find((row) => row.module_key === 'placa-basica');
    const fullPlate = rows.find((row) => row.module_key === 'placa-completa');
    expect(basicPlate?.cost_cents).toBe(280);
    expect(fullPlate?.cost_cents).toBe(4378);
    expect(fullPlate?.endpoint).toBe('/consulta/veiculos/credits');

    const price = await resolvePrice(store, 'PF', 'cpf', 'basic');
    expect(price.source).toBe('catalog');
    expect(price.costCents).toBe(1290);
    expect(price.priceCents).toBe(3870);
  });
});
