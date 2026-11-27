import { describe, expect, it } from 'vitest';
import { activeModules, normalizeModuleInput } from '../supabase/functions/_shared/modules.ts';
import { resolvePrice } from '../supabase/functions/_shared/pricing.ts';
import { MemoryStore } from './helpers/memory-store.ts';

describe('módulos gerenciados pelo administrador', () => {
  it('normaliza um módulo da Verifica Online para uso imediato no Telegram', () => {
    const row = normalizeModuleInput({
      module_key: 'Placa Completa Verifica',
      label: 'Placa completa',
      entity: 'VEICULO',
      key_type: 'placa',
      mode: 'full',
      source: 'verifica-online',
      cost_cents: 120,
      menu_order: 5,
    });

    expect(row.module_key).toBe('placa-completa-verifica');
    expect(row.endpoint).toBe('/datasets/veicular_completa/queries');
    expect(row.dataset_key).toBe('veicular_completa');
    expect(row.managed_by).toBe('admin');
    expect(row.active).toBe(true);
  });

  it('rejeita combinações inválidas de entidade e tipo de chave', () => {
    expect(() => normalizeModuleInput({
      module_key: 'cpf-invalido',
      label: 'CPF inválido',
      entity: 'PF',
      key_type: 'cnpj',
      cost_cents: 10,
    })).toThrow('Tipo de chave inválido');
  });

  it('expõe apenas módulos ativos e válidos para o menu', async () => {
    const store = new MemoryStore();
    await store.insert('api_modules', normalizeModuleInput({
      module_key: 'cpf-admin',
      label: 'CPF admin',
      entity: 'PF',
      key_type: 'cpf',
      source: 'verifica-online',
      cost_cents: 50,
    }));
    await store.insert('api_modules', {
      ...normalizeModuleInput({
        module_key: 'inativo',
        label: 'Inativo',
        entity: 'EMPRESA',
        key_type: 'cnpj',
        source: 'apibrasil',
        endpoint: '/dados/cnpj/credits',
        cost_cents: 50,
      }),
      active: false,
    });
    await store.insert('api_modules', { module_key: 'quebrado', label: 'Quebrado', active: true });

    const modules = await activeModules(store);

    expect(modules.map((module) => module.moduleKey)).toEqual(['cpf-admin']);
  });

  it('resolve preço e dataset de um módulo cadastrado pelo administrador', async () => {
    const store = new MemoryStore();
    await store.insert('api_modules', normalizeModuleInput({
      module_key: 'placa-completa-verifica',
      label: 'Placa completa',
      entity: 'VEICULO',
      key_type: 'placa',
      mode: 'full',
      source: 'verifica-online',
      cost_cents: 120,
    }));

    const price = await resolvePrice(store, 'VEICULO', 'placa', 'full', 'placa-completa-verifica');

    expect(price.provider).toBe('verifica-online');
    expect(price.datasetKey).toBe('veicular_completa');
    expect(price.costCents).toBe(120);
    expect(price.priceCents).toBe(240);
    expect(price.source).toBe('catalog');
  });
});
