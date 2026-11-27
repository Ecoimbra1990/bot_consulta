import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from './helpers/memory-store.ts';

vi.stubEnv('VERIFICA_ONLINE_API_KEY', 'voa_route_key');
vi.stubEnv('VERIFICA_ONLINE_API_BASE', 'https://api.verifica-online.test');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('seleção automática de provedor', () => {
  it('usa a Verifica Online quando o módulo do catálogo é dela', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({
      status: 'succeeded',
      request_id: 'req-route',
      billing: { amount_cents: 399 },
      data: { basic: { name: 'Maria Silva' } },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { runQuery } = await import('../supabase/functions/_shared/queries.ts');

    const store = new MemoryStore();
    await store.insert('users', { id: 'u1', wallet_balance_cents: 100_000, status: 'active' });
    await store.insert('api_modules', {
      module_key: 'pf-cpf',
      endpoint: '/datasets/cpf_dados_completos/queries',
      cost_cents: 399,
      service_name: 'cpf_dados_completos',
      source: 'verifica-online',
      payload_json: { dataset_key: 'cpf_dados_completos' },
    });

    const result = await runQuery(store, {
      userId: 'u1',
      entity: 'PF',
      keyType: 'cpf',
      keyValue: '52998224725',
    });

    expect(result.status).toBe('completed');
    expect(result.provider).toBe('verifica-online');
    expect(result.charged_cents).toBe(800);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.verifica-online.test/datasets/cpf_dados_completos/queries');
  });
});
