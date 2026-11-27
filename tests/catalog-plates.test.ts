import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from './helpers/memory-store.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('catálogo APIBrasil sem Verifica Online', () => {
  it('diferencia placa básica de placa completa', async () => {
    vi.stubEnv('APIBRASIL_CATALOG_URL', 'https://app.apibrasil.io/precos');
    vi.stubEnv('APIBRASIL_TOKEN', 'test-token');
    const payload = {
      error: false,
      status: 200,
      message: '',
      apis: [
        { service_name: 'fipe-placa', name: 'Dados técnicos da placa com Renavam e chassi', value: 2.8, type: 'Api', mode: 'api' },
        { service_name: 'roubo-furto-v2', name: 'Consulta pela placa com alertas de roubo ou furto', value: 12.5, type: 'Api', mode: 'api' },
        { service_name: 'placa-completa', name: 'Consulta placa completa com alertas de roubo e furto', value: 2.49, type: 'Api', mode: 'api' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    const { syncApiCatalog } = await import('../supabase/functions/_shared/catalog.ts');
    const { resolvePrice } = await import('../supabase/functions/_shared/pricing.ts');
    const store = new MemoryStore();

    const result = await syncApiCatalog(store);
    const rows = await store.select('api_modules');
    const basic = rows.find((row) => row.module_key === 'placa-basica');
    const full = rows.find((row) => row.module_key === 'placa-completa');

    expect(result.alerts).toEqual([]);
    expect(rows.map((row) => row.module_key).sort()).toEqual(['placa-basica', 'placa-completa']);
    expect(basic?.cost_cents).toBe(280);
    expect(basic?.source).toBe('apibrasil');
    expect((basic?.payload_json as Record<string, unknown>).service_name).toBe('fipe-placa');
    expect(full?.cost_cents).toBe(249);
    expect(full?.source).toBe('apibrasil');
    expect((full?.payload_json as Record<string, unknown>).service_name).toBe('placa-completa');
    expect((await resolvePrice(store, 'VEICULO', 'placa', 'basic')).priceCents).toBe(560);
    expect((await resolvePrice(store, 'VEICULO', 'placa', 'full')).priceCents).toBe(500);
  });
});
