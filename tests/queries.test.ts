import { describe, expect, it, vi } from 'vitest';
import type { APIBrasilAdapter } from '../supabase/functions/_shared/provider.ts';
import { runQuery } from '../supabase/functions/_shared/queries.ts';
import { MemoryStore } from './helpers/memory-store.ts';

function fakeProvider(): APIBrasilAdapter {
  const result = {
    provider: 'mock',
    ok: true,
    normalized: { nome: 'PESSOA EXEMPLO' },
    raw: {},
    error: '',
    cost_cents: 0,
  };
  return {
    queryPfCpf: vi.fn(async () => result),
    queryCompanyCnpj: vi.fn(async () => result),
    queryPhone: vi.fn(async () => result),
    queryVehiclePlate: vi.fn(async () => result),
    queryVehicleByCpf: vi.fn(async () => result),
  } as unknown as APIBrasilAdapter;
}

describe('execução de consultas', () => {
  it('valida CPF antes de chamar o provedor', async () => {
    const provider = fakeProvider();
    await expect(runQuery(new MemoryStore(), { userId: 'u1', entity: 'PF', keyType: 'cpf', keyValue: '11111111111', provider })).rejects.toThrow('CPF inválido');
    expect(provider.queryPfCpf).not.toHaveBeenCalled();
  });

  it('reaproveita cache não-mock na segunda consulta', async () => {
    const store = new MemoryStore();
    const provider = fakeProvider();
    const input = { userId: 'u1', entity: 'PF', keyType: 'cpf', keyValue: '52998224725', provider };
    const first = await runQuery(store, input);
    expect(first.status).toBe('completed');
    expect(first.provider).toBe('mock');
    const second = await runQuery(store, input);
    expect(second.provider).toBe('cache');
    expect(provider.queryPfCpf).toHaveBeenCalledTimes(1);
    expect(await store.count('query_results')).toBe(2);
  });

  it('registra falha do provedor sem quebrar', async () => {
    const provider = fakeProvider();
    vi.mocked(provider.queryPfCpf).mockResolvedValueOnce({
      provider: 'apibrasil',
      ok: false,
      normalized: {},
      raw: {},
      error: 'Saldo insuficiente',
      cost_cents: 0,
    });
    const result = await runQuery(new MemoryStore(), { userId: 'u1', entity: 'PF', keyType: 'cpf', keyValue: '52998224725', provider });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Saldo insuficiente');
  });
});
