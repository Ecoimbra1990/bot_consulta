import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from './helpers/memory-store.ts';

vi.stubEnv('APIBRASIL_TOKEN', 'abi_route_key');
vi.stubEnv('VERIFICA_ONLINE_API_KEY', 'voa_route_key');
vi.stubEnv('VERIFICA_ONLINE_API_BASE', 'https://api.verifica-online.test');

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('seleção automática de provedor', () => {
  it('usa a APIBrasil no CPF e preserva parentes mesmo com módulo antigo da Verifica Online', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => json({
      error: false,
      response: {
        content: {
          nome: { conteudo: { nome: 'Maria Silva', situacao_receita: 'Regular' } },
          dados_parentes: { conteudo: [{ nome: 'Mae Silva', campo: 'mae', documento: '11144477735' }] },
        },
      },
    }));
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
    const saved = await store.selectOne('query_results', { eq: { query_id: result.id } });

    expect(result.status).toBe('completed');
    expect(result.provider).toBe('apibrasil');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gateway.apibrasil.io/api/v2/consulta/cpf/credits');
    expect(JSON.parse(String(init.body))).toMatchObject({ tipo: 'dados-cadastrais', cpf: '52998224725' });
    expect((saved?.normalized_json as Record<string, any>).parentes[0]).toMatchObject({
      nome: 'Mae Silva',
      vinculo: 'mae',
      cpf: '11144477735',
    });
  });

  it('mantém a Verifica Online para CNPJ quando o módulo do catálogo é dela', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => json({
      status: 'succeeded',
      request_id: 'req-route',
      billing: { amount_cents: 299 },
      data: { basic: { name: 'Empresa Silva' } },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { runQuery } = await import('../supabase/functions/_shared/queries.ts');

    const store = new MemoryStore();
    await store.insert('users', { id: 'u1', wallet_balance_cents: 100_000, status: 'active' });
    await store.insert('api_modules', {
      module_key: 'cnpj',
      endpoint: '/datasets/cnpj_dados_basicos/queries',
      cost_cents: 299,
      service_name: 'cnpj_dados_basicos',
      source: 'verifica-online',
      payload_json: { dataset_key: 'cnpj_dados_basicos' },
    });

    const result = await runQuery(store, {
      userId: 'u1',
      entity: 'EMPRESA',
      keyType: 'cnpj',
      keyValue: '11444777000161',
    });

    expect(result.status).toBe('completed');
    expect(result.provider).toBe('verifica-online');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.verifica-online.test/datasets/cnpj_dados_basicos/queries');
  });
});
