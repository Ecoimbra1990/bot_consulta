import { config } from './env.ts';
import type { Row, Store } from './types.ts';

interface FoundValue {
  key: string;
  value: unknown;
}

function deepFind(value: unknown, keys: string[], depth = 0): FoundValue | undefined {
  if (depth > 4 || value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, keys, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  const row = value as Row;
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return { key, value: row[key] };
    }
  }
  for (const nested of Object.values(row)) {
    const found = deepFind(nested, keys, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function parseMoney(value: unknown, key = ''): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    const isCents = /cent/i.test(key);
    return Math.max(0, Math.round(isCents ? value : value * 100));
  }
  const raw = String(value).replace(/[^\d,.-]/g, '').trim();
  if (!raw) {
    return undefined;
  }
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    return undefined;
  }
  const isCents = /cent/i.test(key);
  return Math.max(0, Math.round(isCents ? amount : amount * 100));
}

function text(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value).trim();
}

const CANONICAL_MODULE_KEYS = new Set(['pf-cpf', 'cnpj', 'telefone', 'placa-basica', 'placa-completa']);

function slugify(value: unknown): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function canonicalModuleKey(value: unknown): string {
  const slug = slugify(value);
  if (!slug || slug.length > 80) {
    return '';
  }
  if (CANONICAL_MODULE_KEYS.has(slug)) {
    return slug;
  }
  if (/telefone|phone|celular/.test(slug)) {
    return 'telefone';
  }
  if (/veiculo|placa|renavam/.test(slug)) {
    return /complet|full|furto|roubo|renavam|historico/.test(slug) ? 'placa-completa' : 'placa-basica';
  }
  if (/cnpj|empresa|pessoa-juridica|(^|-)pj(-|$)/.test(slug)) {
    return 'cnpj';
  }
  if (/cpf|(^|-)pf(-|$)|pessoa-fisica/.test(slug)) {
    return 'pf-cpf';
  }
  return '';
}

function canonicalEndpoint(moduleKey: string): string {
  if (moduleKey === 'pf-cpf') return config.apiBrasil.pfPath;
  if (moduleKey === 'cnpj') return config.apiBrasil.companyPath;
  if (moduleKey === 'telefone') return config.apiBrasil.phonePath;
  if (moduleKey === 'placa-basica') return config.apiBrasil.vehiclePlatePath;
  if (moduleKey === 'placa-completa') return config.apiBrasil.vehicleFullPath || config.apiBrasil.vehiclePlatePath;
  return '';
}

function collectObjects(value: unknown, output: Row[] = [], depth = 0): Row[] {
  if (depth > 4 || value === null || value === undefined) {
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjects(item, output, depth + 1);
    }
    return output;
  }
  if (typeof value !== 'object') {
    return output;
  }
  output.push(value as Row);
  for (const nested of Object.values(value as Row)) {
    if (typeof nested === 'object' && nested !== null) {
      collectObjects(nested, output, depth + 1);
    }
  }
  return output;
}

async function fetchJson(url: string): Promise<Row> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.apiBrasil.token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`APIBrasil HTTP ${response.status} em ${new URL(url).pathname}`);
  }
  return (await response.json()) as Row;
}

export interface CatalogSyncResult {
  modules: number;
  skipped: number;
  balanceCents: number | null;
  alerts: string[];
}

export async function syncApiCatalog(store: Store): Promise<CatalogSyncResult> {
  if (!config.apiBrasil.catalogUrl || !config.apiBrasil.token) {
    throw new Error('APIBRASIL_CATALOG_URL e APIBRASIL_TOKEN são obrigatórios para sincronizar o catálogo');
  }
  const payload = await fetchJson(config.apiBrasil.catalogUrl);
  const candidates = collectObjects(payload);
  const alerts: string[] = [];
  const selected = new Map<string, Row>();
  let skipped = 0;

  const message = text(payload.message);
  if (payload.error === true || /plano ativo|sem credito|sem saldo/i.test(message)) {
    alerts.push(`APIBrasil: ${message || 'resposta indicando indisponibilidade'}`);
  }

  for (const candidate of candidates) {
    const rawEndpoint = text(candidate.endpoint ?? candidate.path ?? candidate.url ?? candidate.rota ?? candidate.route ?? candidate.api ?? candidate.search);
    const rawModuleKey = text(
      candidate.module_key ?? candidate.service_name ?? candidate.key ?? candidate.slug ?? candidate.id ?? candidate.module ?? candidate.nome ?? candidate.name,
    );
    const foundCost = deepFind(candidate, ['cost_cents', 'price_cents', 'preco_centavos', 'custo_centavos', 'cost', 'custo', 'price', 'preco', 'valor', 'value']);
    const costCents = foundCost ? parseMoney(foundCost.value, foundCost.key) ?? 0 : 0;
    const mappedKey = canonicalModuleKey(rawModuleKey) || canonicalModuleKey(rawEndpoint);
    const moduleKey = mappedKey || rawModuleKey;
    const endpoint = mappedKey ? canonicalEndpoint(mappedKey) || rawEndpoint : rawEndpoint;
    if (!endpoint || !moduleKey || costCents <= 0) {
      skipped += 1;
      continue;
    }
    const priceCents = Math.ceil((costCents * config.pricingMultiplier) / 10) * 10;
    if (priceCents <= costCents) {
      alerts.push(`Módulo ${moduleKey}: preço ${priceCents} não cobre custo ${costCents}`);
    }
    const existing = selected.get(moduleKey);
    if (!existing || costCents > Number(existing.cost_cents ?? 0)) {
      selected.set(moduleKey, {
        module_key: moduleKey,
        label: text(candidate.label ?? candidate.descricao ?? candidate.description ?? candidate.name ?? candidate.nome ?? candidate.service_name, moduleKey),
        endpoint,
        cost_cents: costCents,
        balance_cents: null,
        source: 'apibrasil',
        payload_json: candidate,
        updated_at: new Date().toISOString(),
      });
    }
  }

  for (const row of selected.values()) {
    await store.upsert('api_modules', row, 'module_key');
  }

  const modules = selected.size;

  if (modules === 0) {
    alerts.push('Catálogo sincronizado sem módulos com custo positivo; consultas permanecerão bloqueadas');
  }

  let balanceCents: number | null = null;
  if (config.apiBrasil.accountUrl) {
    try {
      const account = await fetchJson(config.apiBrasil.accountUrl);
      const foundBalance = deepFind(account, ['balance_cents', 'saldo_centavos', 'credit_balance_cents', 'balance', 'saldo', 'creditos', 'credits']);
      balanceCents = foundBalance ? parseMoney(foundBalance.value, foundBalance.key) ?? null : null;
      if (balanceCents !== null) {
        for (const row of await store.select('api_modules', { limit: 500 })) {
          await store.update('api_modules', String(row.module_key), {
            balance_cents: balanceCents,
            updated_at: new Date().toISOString(),
          }, 'module_key');
        }
      }
    } catch (error) {
      alerts.push(`Não foi possível consultar saldo da APIBrasil: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { modules, skipped, balanceCents, alerts };
}
