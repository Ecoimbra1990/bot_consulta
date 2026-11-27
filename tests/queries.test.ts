import { describe, expect, it, vi } from 'vitest';
import type { APIBrasilAdapter } from '../supabase/functions/_shared/provider.ts';
import { runQuery } from '../supabase/functions/_shared/queries.ts';
import { InsufficientBalanceError } from '../supabase/functions/_shared/wallet.ts';
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

async function seedUser(store: MemoryStore, id: string, walletBalanceCents = 100_000): Promise<void> {
  await store.insert('users', { id, wallet_balance_cents: walletBalanceCents, status: 'active' });
}

async function balance(store: MemoryStore, id: string): Promise<number> {
  const user = await store.selectById('users', id);
  return Number(user?.wallet_balance_cents ?? 0);
}

describe('execução de consultas', () => {
  it('valida CPF antes de chamar o provedor', async () => {
    const store = new MemoryStore();
    await seedUser(store, 'u1');
    const provider = fakeProvider();
    await expect(runQuery(store, { userId: 'u1', entity: 'PF', keyType: 'cpf', keyValue: '11111111111', provider })).rejects.toThrow('CPF inválido');
    expect(provider.queryPfCpf).not.toHaveBeenCalled();
  });

  it('débita a consulta e reaproveita cache sem nova cobrança', async () => {
    const store = new MemoryStore();
    await seedUser(store, 'u1');
    const provider = fakeProvider();
    const input = { userId: 'u1', entity: 'PF', keyType: 'cpf', keyValue: '52998224725', provider };
    const first = await runQuery(store, input);
    expect(first.status).toBe('completed');
    expect(first.provider).toBe('mock');
    expect(first.charged_cents).toBe(60);
    expect(await balance(store, 'u1')).toBe(99_940);
    const second = await runQuery(store, input);
    expect(second.provider).toBe('cache');
    expect(second.charged_cents).toBe(0);
    expect(provider.queryPfCpf).toHaveBeenCalledTimes(1);
    expect(await balance(store, 'u1')).toBe(99_940);
    expect(await store.count('query_results')).toBe(2);
  });

  it('envia service_name e endpoint do catálogo ao provedor', async () => {
    const store = new MemoryStore();
    await seedUser(store, 'u1');
    await store.insert('api_modules', {
      module_key: 'pf-cpf',
      endpoint: '/consulta/cpf/credits',
      cost_cents: 34,
      service_name: 'dados-cadastrais',
      payload_json: { service_name: 'dados-cadastrais' },
    });
    const provider = fakeProvider();
    const result = await runQuery(store, {
      userId: 'u1',
      entity: 'PF',
      keyType: 'cpf',
      keyValue: '52998224725',
      provider,
    });
    expect(result.status).toBe('completed');
    expect(provider.queryPfCpf).toHaveBeenCalledWith('52998224725', {
      serviceName: 'dados-cadastrais',
      path: '/consulta/cpf/credits',
    });
    expect(result.charged_cents).toBe(70);
  });

  it('estorna o valor quando o provedor falha', async () => {
    const store = new MemoryStore();
    await seedUser(store, 'u1');
    const provider = fakeProvider();
    vi.mocked(provider.queryPfCpf).mockResolvedValueOnce({
      provider: 'apibrasil',
      ok: false,
      normalized: {},
      raw: {},
      error: 'Saldo insuficiente',
      cost_cents: 0,
    });
    const result = await runQuery(store, { userId: 'u1', entity: 'PF', keyType: 'cpf', keyValue: '52998224725', provider });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Saldo insuficiente');
    expect(result.charged_cents).toBe(0);
    expect(await balance(store, 'u1')).toBe(100_000);
    const movements = await store.select('wallet_transactions', { eq: { user_id: 'u1' } });
    expect(movements.map((item) => item.kind)).toEqual(['debit', 'refund']);
  });

  it('bloqueia consulta com saldo insuficiente', async () => {
    const store = new MemoryStore();
    await seedUser(store, 'u1', 10);
    await expect(runQuery(store, {
      userId: 'u1',
      entity: 'PF',
      keyType: 'cpf',
      keyValue: '52998224725',
      provider: fakeProvider(),
    })).rejects.toBeInstanceOf(InsufficientBalanceError);
  });
});
