import { config } from './env.ts';
import { activeModules } from './modules.ts';
import type { Row, Store } from './types.ts';

function configuredPrice(name: string, fallback: number): number {
  const parsed = Number.parseInt(envPrice(name, fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envPrice(name: string, fallback: number): string {
  const host = globalThis as typeof globalThis & {
    Deno?: { env: { get(key: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  return host.Deno?.env?.get(`PRICE_${name}_CENTS`) ?? host.process?.env?.[`PRICE_${name}_CENTS`] ?? String(fallback);
}

export const WELCOME_BONUS_CENTS = (() => {
  const host = globalThis as typeof globalThis & {
    Deno?: { env: { get(key: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  const raw = host.Deno?.env?.get('WELCOME_BONUS_CENTS') ?? host.process?.env?.['WELCOME_BONUS_CENTS'] ?? '150';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 150;
})();

export type QueryMode = 'basic' | 'full';

const FALLBACK_PRICES: Record<string, number> = {
  'PF:cpf:basic': configuredPrice('CPF', 60),
  'EMPRESA:cnpj:basic': configuredPrice('CNPJ', 25),
  'TELEFONE:telefone:basic': configuredPrice('PHONE', 60),
  'VEICULO:placa:basic': configuredPrice('PLATE', 120),
  'VEICULO:placa:full': configuredPrice('FULL', 300),
  'VEICULO:renavam:basic': configuredPrice('FULL', 300),
  'VEICULO:cpf:basic': configuredPrice('FULL', 300),
  'VEICULO_FROTA:cpf:basic': configuredPrice('FULL', 300),
};

const MODULE_KEYS: Record<string, string> = {
  'PF:cpf:basic': 'pf-cpf',
  'EMPRESA:cnpj:basic': 'cnpj',
  'TELEFONE:telefone:basic': 'telefone',
  'VEICULO:placa:basic': 'placa-basica',
  'VEICULO:placa:full': 'placa-completa',
  'VEICULO:renavam:basic': 'renavam',
  'VEICULO:cpf:basic': 'frota-cpf',
  'VEICULO_FROTA:cpf:basic': 'frota-cpf',
};

const VERIFICA_MODULES = new Set(['pf-cpf', 'cnpj', 'placa-basica', 'placa-completa']);

const DEFAULT_SERVICE_NAMES: Record<string, string> = {
  'pf-cpf': 'cpf_dados_completos',
  cnpj: 'cnpj_dados_basicos',
  telefone: 'cpf-cnpj-pelo-telefone',
  'placa-basica': 'consulta_placa',
  'placa-completa': 'veicular_completa',
  renavam: 'frota-pf',
  'frota-cpf': 'frota-pf',
};

export type QueryProviderName = 'verifica-online' | 'apibrasil';

export interface ResolvedPrice {
  moduleKey: string;
  endpoint: string;
  serviceName: string;
  datasetKey: string;
  provider: QueryProviderName;
  costCents: number;
  priceCents: number;
  source: 'catalog' | 'fallback';
}

export function moduleKeyFor(entity: string, keyType: string, mode: QueryMode): string {
  return MODULE_KEYS[`${entity}:${keyType}:${mode}`] ?? MODULE_KEYS[`${entity}:${keyType}:basic`] ?? `${entity}-${keyType}`;
}

export function endpointFor(entity: string, keyType: string, mode: QueryMode): string {
  const api = config.apiBrasil;
  const key = moduleKeyFor(entity, keyType, mode);
  if (key === 'pf-cpf') return '/datasets/cpf_dados_completos/queries';
  if (key === 'cnpj') return '/datasets/cnpj_dados_basicos/queries';
  if (key === 'placa-basica') return '/datasets/consulta_placa/queries';
  if (key === 'placa-completa') return '/datasets/veicular_completa/queries';
  if (key === 'telefone') return api.phonePath;
  if (key === 'renavam' || key === 'frota-cpf') return api.vehicleFleetPath;
  return '';
}

function normalizeEndpoint(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  try {
    return new URL(text).pathname.replace(/\/+$/, '');
  } catch {
    return text.replace(/\/+$/, '');
  }
}

function datasetFromEndpoint(endpoint: string): string {
  const match = endpoint.match(/\/datasets\/([a-z0-9_-]+)\/queries/i);
  return match ? match[1].toLowerCase() : '';
}

function rowServiceName(row: Row | undefined, moduleKey: string): string {
  const payload = row?.payload_json !== null && typeof row?.payload_json === 'object'
    ? row?.payload_json as Row
    : {};
  const service = String(row?.service_name ?? payload.service_name ?? payload.tipo ?? '').trim();
  return service || DEFAULT_SERVICE_NAMES[moduleKey] || '';
}

export function fallbackPriceFor(entity: string, keyType: string, mode: QueryMode = 'basic'): number {
  return FALLBACK_PRICES[`${entity}:${keyType}:${mode}`] ?? FALLBACK_PRICES[`${entity}:${keyType}:basic`] ?? 60;
}

export async function resolvePrice(
  store: Store,
  entity: string,
  keyType: string,
  mode: QueryMode = 'basic',
  preferredModuleKey?: string,
): Promise<ResolvedPrice> {
  const canonicalKey = moduleKeyFor(entity, keyType, mode);
  const endpoint = endpointFor(entity, keyType, mode);
  const rows = await store.select('api_modules', { limit: 500 });
  const wantedEndpoint = normalizeEndpoint(endpoint);
  const row = preferredModuleKey
    ? rows.find((item) => String(item.module_key ?? '') === preferredModuleKey)
    : rows.find((item) => String(item.module_key ?? '') === canonicalKey)
      ?? rows.find((item) => normalizeEndpoint(item.endpoint) === wantedEndpoint && wantedEndpoint !== '');
  if (preferredModuleKey && row) {
    if (row.active === false) {
      throw new Error(`Módulo ${preferredModuleKey} está inativo`);
    }
    const rowEntity = String(row.entity ?? entity).toUpperCase();
    const rowKeyType = String(row.key_type ?? keyType).toLowerCase();
    const rowMode = String(row.mode ?? 'basic').toLowerCase() === 'full' ? 'full' : 'basic';
    if (rowEntity !== entity.toUpperCase() || rowKeyType !== keyType.toLowerCase() || rowMode !== mode) {
      throw new Error(`Módulo ${preferredModuleKey} não corresponde à consulta solicitada`);
    }
  }
  const moduleKey = preferredModuleKey ?? canonicalKey;
  const costCents = Math.max(0, Number.parseInt(String(row?.cost_cents ?? 0), 10) || 0);
  const fallback = fallbackPriceFor(entity, keyType, mode);
  const selectedEndpoint = normalizeEndpoint(row?.endpoint) || endpoint;
  const serviceName = rowServiceName(row, moduleKey);
  const payload = row?.payload_json !== null && typeof row?.payload_json === 'object' ? row?.payload_json as Row : {};
  const datasetKey = String(row?.dataset_key ?? payload.dataset_key ?? '').trim()
    || datasetFromEndpoint(selectedEndpoint)
    || DEFAULT_SERVICE_NAMES[moduleKey]
    || '';
  const provider: QueryProviderName = row?.source === 'verifica-online' || (!row && VERIFICA_MODULES.has(moduleKey))
    ? 'verifica-online'
    : 'apibrasil';

  if (costCents > 0) {
    const withMargin = Math.ceil((costCents * config.pricingMultiplier) / 10) * 10;
    return {
      moduleKey,
      endpoint: selectedEndpoint,
      serviceName,
      datasetKey,
      provider,
      costCents,
      priceCents: Math.max(10, withMargin),
      source: 'catalog',
    };
  }

  return {
    moduleKey,
    endpoint: selectedEndpoint,
    serviceName,
    datasetKey,
    provider,
    costCents: 0,
    priceCents: fallback,
    source: 'fallback',
  };
}

export function assertSafeMargin(price: ResolvedPrice): void {
  const requiresCatalog = price.provider === 'verifica-online'
    ? Boolean(config.verificaOnline.apiKey)
    : Boolean(config.apiBrasil.catalogUrl);
  if (requiresCatalog && price.source !== 'catalog') {
    throw new Error(`Módulo ${price.moduleKey} sem custo catalogado; consulta bloqueada`);
  }
  if (price.costCents > 0 && price.priceCents <= price.costCents) {
    throw new Error(`Preço ${price.priceCents} abaixo do custo ${price.costCents}; consulta bloqueada`);
  }
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export async function priceTable(store: Store): Promise<string> {
  const modules = await activeModules(store);
  const lines = ['Tabela de preços (descontados do seu saldo):'];
  if (modules.length === 0) {
    const entries: Array<[string, string, string, QueryMode]> = [
      ['CNPJ', 'EMPRESA', 'cnpj', 'basic'],
      ['CPF', 'PF', 'cpf', 'basic'],
      ['Telefone', 'TELEFONE', 'telefone', 'basic'],
      ['Placa básica', 'VEICULO', 'placa', 'basic'],
      ['Completa + furto/roubo', 'VEICULO', 'placa', 'full'],
    ];
    for (const [label, entity, keyType, mode] of entries) {
      const price = await resolvePrice(store, entity, keyType, mode);
      lines.push(`${label}: ${formatMoney(price.priceCents)}`);
    }
  } else {
    for (const module of modules) {
      const price = await resolvePrice(store, module.entity, module.keyType, module.mode, module.moduleKey);
      lines.push(`${module.label}: ${formatMoney(price.priceCents)}`);
    }
  }
  lines.push('', 'Consultas em cache não cobram saldo.');
  return lines.join('\n');
}
