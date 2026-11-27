import { config } from './env.ts';
import type { Store } from './types.ts';

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
  'VEICULO:renavam:basic': 'placa-completa',
  'VEICULO:cpf:basic': 'placa-completa',
  'VEICULO_FROTA:cpf:basic': 'placa-completa',
};

export interface ResolvedPrice {
  moduleKey: string;
  endpoint: string;
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
  if (key === 'pf-cpf') return api.pfPath;
  if (key === 'cnpj') return api.companyPath;
  if (key === 'telefone') return api.phonePath;
  if (key === 'placa-basica') return api.vehiclePlatePath;
  if (key === 'placa-completa') return api.vehicleFullPath || api.vehiclePlatePath;
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

export function fallbackPriceFor(entity: string, keyType: string, mode: QueryMode = 'basic'): number {
  return FALLBACK_PRICES[`${entity}:${keyType}:${mode}`] ?? FALLBACK_PRICES[`${entity}:${keyType}:basic`] ?? 60;
}

export async function resolvePrice(
  store: Store,
  entity: string,
  keyType: string,
  mode: QueryMode = 'basic',
): Promise<ResolvedPrice> {
  const moduleKey = moduleKeyFor(entity, keyType, mode);
  const endpoint = endpointFor(entity, keyType, mode);
  const rows = await store.select('api_modules', { limit: 500 });
  const wantedEndpoint = normalizeEndpoint(endpoint);
  const row = rows.find((item) =>
    (normalizeEndpoint(item.endpoint) === wantedEndpoint && wantedEndpoint !== '')
    || String(item.module_key ?? '') === moduleKey
  );
  const costCents = Math.max(0, Number.parseInt(String(row?.cost_cents ?? 0), 10) || 0);
  const fallback = fallbackPriceFor(entity, keyType, mode);

  if (costCents > 0) {
    const withMargin = Math.ceil((costCents * config.pricingMultiplier) / 10) * 10;
    return {
      moduleKey,
      endpoint,
      costCents,
      priceCents: Math.max(10, withMargin),
      source: 'catalog',
    };
  }

  return { moduleKey, endpoint, costCents: 0, priceCents: fallback, source: 'fallback' };
}

export function assertSafeMargin(price: ResolvedPrice): void {
  if (config.apiBrasil.catalogUrl && price.source !== 'catalog') {
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
  const entries: Array<[string, string, string, QueryMode]> = [
    ['CNPJ', 'EMPRESA', 'cnpj', 'basic'],
    ['CPF', 'PF', 'cpf', 'basic'],
    ['Telefone', 'TELEFONE', 'telefone', 'basic'],
    ['Placa básica', 'VEICULO', 'placa', 'basic'],
    ['Completa + furto/roubo', 'VEICULO', 'placa', 'full'],
  ];
  const lines = ['Tabela de preços (descontados do seu saldo):'];
  for (const [label, entity, keyType, mode] of entries) {
    const price = await resolvePrice(store, entity, keyType, mode);
    lines.push(`${label}: ${formatMoney(price.priceCents)}`);
  }
  lines.push('', 'Consultas em cache não cobram saldo.');
  return lines.join('\n');
}
