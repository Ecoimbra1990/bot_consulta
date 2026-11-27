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

interface BenefitRule {
  canonicalKey: string;
  preferred: string[];
}

const PLATE_PREFERRED_SERVICES = [
  'roubo-furto-v2',
  'veicular-360',
  'alertas-e-historico-veiculo',
  'consulta-roubo-e-furto',
];

const BENEFIT_RULES: BenefitRule[] = [
  { canonicalKey: 'pf-cpf', preferred: ['dados-cadastrais'] },
  { canonicalKey: 'cnpj', preferred: ['cnpj'] },
  { canonicalKey: 'telefone', preferred: ['cpf-cnpj-pelo-telefone'] },
  { canonicalKey: 'placa-basica', preferred: PLATE_PREFERRED_SERVICES },
  { canonicalKey: 'placa-completa', preferred: PLATE_PREFERRED_SERVICES },
];

const SERVICE_ENDPOINTS: Record<string, string> = {
  cnpj: '/dados/cnpj/credits',
  'cnpj-cadastral': '/dados/cnpj/credits',
  'receita-federal': config.apiBrasil.pfPath,
  'dados-cadastrais': config.apiBrasil.pfPath,
  'dados-cadastrais-basicos': config.apiBrasil.pfPath,
  'cadastro-pf-basico': config.apiBrasil.pfPath,
  'cpf-cadastral': config.apiBrasil.pfPath,
  'cpf-cnpj-pelo-telefone': config.apiBrasil.phonePath,
  'roubo-furto-v2': config.apiBrasil.vehiclePlatePath,
  'veicular-360': config.apiBrasil.vehiclePlatePath,
};

function slugify(value: unknown): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function canonicalModuleKey(...values: unknown[]): string {
  const slugs = values.map(slugify).filter((slug) => slug.length > 0 && slug.length <= 200);
  const joined = slugs.join(' ');
  for (const slug of slugs) {
    if (CANONICAL_MODULE_KEYS.has(slug)) {
      return slug;
    }
  }
  if (/veiculo|placa|renavam|chassi/.test(joined)) {
    return /roubo|furto|sinistro|leilao|recall|alerta|historico|complet|full|panorama/.test(joined)
      ? 'placa-completa'
      : 'placa-basica';
  }
  if (/telefone|phone|celular/.test(joined)) {
    return 'telefone';
  }
  if (/cnpj|empresa|pessoa-juridica|(^|-)pj(-|$)/.test(joined)) {
    return 'cnpj';
  }
  if (/cpf|(^|-)pf(-|$)|pessoa-fisica/.test(joined)) {
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

function serviceNameOf(candidate: Row): string {
  return text(
    candidate.service_name
      ?? candidate.tipo
      ?? candidate.module_key
      ?? candidate.key
      ?? candidate.slug
      ?? candidate.id,
  );
}

function candidateEndpoint(candidate: Row, service: string, moduleKey: string): string {
  const search = text(candidate.search);
  const raw = text(
    candidate.endpoint
      ?? candidate.path
      ?? candidate.url
      ?? candidate.rota
      ?? candidate.route
      ?? candidate.api
      ?? (search.startsWith('/') ? search : ''),
  );
  return (raw || SERVICE_ENDPOINTS[service] || canonicalEndpoint(moduleKey)).trim();
}

function preferenceRank(rule: BenefitRule, service: string): number {
  const index = rule.preferred.indexOf(service);
  return index === -1 ? rule.preferred.length : index;
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
  const selectionMeta = new Map<string, { rank: number; cost: number }>();
  let skipped = 0;

  const message = text(payload.message);
  if (payload.error === true || /sem credito|sem saldo|saldo insuficiente/i.test(message)) {
    alerts.push(`APIBrasil: ${message || 'resposta indicando indisponibilidade'}`);
  }

  for (const candidate of candidates) {
    const service = serviceNameOf(candidate);
    const rawEndpoint = candidateEndpoint(candidate, service, '');
    const rawModuleKey = text(
      candidate.module_key ?? candidate.service_name ?? candidate.key ?? candidate.slug ?? candidate.id ?? candidate.module ?? candidate.nome ?? candidate.name,
    );
    const description = text(candidate.label ?? candidate.descricao ?? candidate.description ?? candidate.name ?? candidate.nome);
    const foundCost = deepFind(candidate, ['cost_cents', 'price_cents', 'preco_centavos', 'custo_centavos', 'cost', 'custo', 'price', 'preco', 'valor', 'value']);
    const costCents = foundCost ? parseMoney(foundCost.value, foundCost.key) ?? 0 : 0;
    const mappedKey = canonicalModuleKey(rawModuleKey, description, rawEndpoint);
    if (!service || costCents <= 0 || (!mappedKey && service !== 'roubo-furto-v2')) {
      skipped += 1;
      continue;
    }
    const canonicalKeys = mappedKey === 'placa-completa'
      ? ['placa-completa', 'placa-basica']
      : mappedKey === 'roubo-furto-v2' || service === 'roubo-furto-v2'
        ? ['placa-completa', 'placa-basica']
        : mappedKey
          ? [mappedKey]
          : ['placa-completa', 'placa-basica'];

    for (const moduleKey of canonicalKeys) {
      const rule = BENEFIT_RULES.find((item) => item.canonicalKey === moduleKey);
      if (!rule) {
        continue;
      }
      if (!rule.preferred.includes(service)) {
        continue;
      }
      const rank = preferenceRank(rule, service);
      const current = selectionMeta.get(moduleKey);
      if (current && !(costCents < current.cost || (costCents === current.cost && rank < current.rank))) {
        continue;
      }
      const endpoint = candidateEndpoint(candidate, service, moduleKey);
      if (!endpoint.startsWith('/')) {
        continue;
      }
      const priceCents = Math.ceil((costCents * config.pricingMultiplier) / 10) * 10;
      if (priceCents <= costCents) {
        alerts.push(`Módulo ${moduleKey}: preço ${priceCents} não cobre custo ${costCents}`);
      }
      selectionMeta.set(moduleKey, { rank, cost: costCents });
      selected.set(moduleKey, {
        module_key: moduleKey,
        label: text(candidate.label ?? candidate.descricao ?? candidate.description ?? candidate.name ?? candidate.nome ?? service, moduleKey),
        endpoint,
        cost_cents: costCents,
        balance_cents: null,
        source: 'apibrasil',
        payload_json: { ...candidate, service_name: service },
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
