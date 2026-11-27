import { config } from './env.ts';
import { CATALOG_MODULE_DEFAULTS } from './modules.ts';
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

const CANONICAL_MODULE_KEYS = new Set(['pf-cpf', 'cnpj', 'telefone', 'placa-basica', 'placa-completa', 'frota-cpf', 'renavam']);

const VERIFICA_MODULE_KEYS: Record<string, string> = {
  cpf_dados_completos: 'pf-cpf',
  cnpj_dados_basicos: 'cnpj',
  consulta_placa: 'placa-basica',
  veicular_completa: 'placa-completa',
};

interface BenefitRule {
  canonicalKey: string;
  preferred: string[];
}

const BASIC_PLATE_SERVICES = [
  'consulta-placa',
  'placa-basica',
  'fipe-placa',
  'dados-veiculo',
  'veiculo-por-placa',
];

const FULL_PLATE_SERVICES = [
  'placa-completa',
  'roubo-furto-v2',
  'veicular-360',
  'alertas-e-historico-veiculo',
  'consulta-roubo-e-furto',
];

const BENEFIT_RULES: BenefitRule[] = [
  { canonicalKey: 'pf-cpf', preferred: ['dados-cadastrais'] },
  { canonicalKey: 'cnpj', preferred: ['cnpj'] },
  { canonicalKey: 'telefone', preferred: ['cpf-cnpj-pelo-telefone'] },
  { canonicalKey: 'placa-basica', preferred: BASIC_PLATE_SERVICES },
  { canonicalKey: 'placa-completa', preferred: FULL_PLATE_SERVICES },
  { canonicalKey: 'frota-cpf', preferred: ['frota-pf'] },
  { canonicalKey: 'renavam', preferred: ['frota-pf'] },
];

const SERVICE_ENDPOINTS: Record<string, string> = {
  'frota-pf': config.apiBrasil.vehicleFleetPath,
  cnpj: '/dados/cnpj/credits',
  'cnpj-cadastral': '/dados/cnpj/credits',
  'receita-federal': config.apiBrasil.pfPath,
  'dados-cadastrais': config.apiBrasil.pfPath,
  'dados-cadastrais-basicos': config.apiBrasil.pfPath,
  'cadastro-pf-basico': config.apiBrasil.pfPath,
  'cpf-cadastral': config.apiBrasil.pfPath,
  'cpf-cnpj-pelo-telefone': config.apiBrasil.phonePath,
  'fipe-placa': config.apiBrasil.vehiclePlatePath,
  'consulta-placa': config.apiBrasil.vehiclePlatePath,
  'placa-completa': config.apiBrasil.vehicleFullPath || config.apiBrasil.vehiclePlatePath,
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
  if (/frota/.test(joined)) {
    return 'frota-cpf';
  }
  if (/renavam/.test(joined) && !/placa|veiculo|chassi/.test(joined)) {
    return 'renavam';
  }
  if (/veiculo|placa|chassi/.test(joined)) {
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
  if (moduleKey === 'frota-cpf' || moduleKey === 'renavam') return config.apiBrasil.vehicleFleetPath;
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

async function fetchJson(url: string, headers: Record<string, string>, provider: string): Promise<Row> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${provider} HTTP ${response.status} em ${new URL(url).pathname}`);
  }
  return (await response.json()) as Row;
}

function apiBrasilHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.apiBrasil.token}` };
}

function verificaHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.verificaOnline.apiKey}` };
}

export interface CatalogSyncResult {
  modules: number;
  skipped: number;
  balanceCents: number | null;
  alerts: string[];
}

async function fetchVerificaModules(alerts: string[]): Promise<Map<string, Row>> {
  const selected = new Map<string, Row>();
  if (!config.verificaOnline.apiKey) {
    return selected;
  }
  try {
    const url = `${config.verificaOnline.baseUrl}/datasets`;
    const payload = await fetchJson(url, verificaHeaders(), 'Verifica Online');
    const datasets = Array.isArray(payload.datasets) ? payload.datasets as Row[] : [];
    for (const dataset of datasets) {
      const datasetKey = text(dataset.key);
      const moduleKey = VERIFICA_MODULE_KEYS[datasetKey];
      if (!moduleKey || dataset.enabled === false || dataset.enabled === 0) {
        continue;
      }
      const costCents = parseMoney(dataset.price_cents, 'price_cents') ?? 0;
      if (costCents <= 0) {
        alerts.push(`Verifica Online: dataset ${datasetKey} sem preço positivo; módulo ${moduleKey} não foi atualizado`);
        continue;
      }
      const defaults = CATALOG_MODULE_DEFAULTS[moduleKey];
      selected.set(moduleKey, {
        module_key: moduleKey,
        label: text(dataset.name ?? dataset.description ?? datasetKey, datasetKey),
        endpoint: `/datasets/${datasetKey}/queries`,
        cost_cents: costCents,
        balance_cents: null,
        source: 'verifica-online',
        entity: defaults?.entity ?? null,
        key_type: defaults?.keyType ?? null,
        mode: defaults?.mode ?? 'basic',
        dataset_key: datasetKey,
        service_name: datasetKey,
        active: true,
        managed_by: 'catalog',
        menu_order: defaults?.menuOrder ?? 100,
        payload_json: { ...dataset, dataset_key: datasetKey },
        updated_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    alerts.push(`Não foi possível consultar o catálogo da Verifica Online: ${error instanceof Error ? error.message : String(error)}`);
  }
  return selected;
}

export async function syncApiCatalog(store: Store): Promise<CatalogSyncResult> {
  const hasApiBrasil = Boolean(config.apiBrasil.catalogUrl && config.apiBrasil.token);
  if (!config.verificaOnline.apiKey && !hasApiBrasil) {
    throw new Error('Configure VERIFICA_ONLINE_API_KEY ou APIBRASIL_CATALOG_URL e APIBRASIL_TOKEN para sincronizar o catálogo');
  }

  const alerts: string[] = [];
  const selected = new Map<string, Row>();
  const selectionMeta = new Map<string, { rank: number; cost: number }>();
  let skipped = 0;

  if (hasApiBrasil) {
    const payload = await fetchJson(config.apiBrasil.catalogUrl, apiBrasilHeaders(), 'APIBrasil').catch((error: unknown) => {
      alerts.push(`Não foi possível consultar o catálogo da APIBrasil: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (payload) {
      const message = text(payload.message);
      if (payload.error === true || /sem credito|sem saldo|saldo insuficiente/i.test(message)) {
        alerts.push(`APIBrasil: ${message || 'resposta indicando indisponibilidade'}`);
      }
      for (const candidate of collectObjects(payload)) {
        const service = serviceNameOf(candidate);
        const rawEndpoint = candidateEndpoint(candidate, service, '');
        const rawModuleKey = text(
          candidate.module_key ?? candidate.service_name ?? candidate.key ?? candidate.slug ?? candidate.id ?? candidate.module ?? candidate.nome ?? candidate.name,
        );
        const description = text(candidate.label ?? candidate.descricao ?? candidate.description ?? candidate.name ?? candidate.nome);
        const foundCost = deepFind(candidate, ['cost_cents', 'price_cents', 'preco_centavos', 'custo_centavos', 'cost', 'custo', 'price', 'preco', 'valor', 'value']);
        const costCents = foundCost ? parseMoney(foundCost.value, foundCost.key) ?? 0 : 0;
        const mappedKey = canonicalModuleKey(rawModuleKey, description, rawEndpoint);
        if (!service || costCents <= 0 || !mappedKey) {
          skipped += 1;
          continue;
        }
        const canonicalKeys = mappedKey ? [mappedKey] : [];

        for (const moduleKey of canonicalKeys) {
          const rule = BENEFIT_RULES.find((item) => item.canonicalKey === moduleKey);
          if (!rule || !rule.preferred.includes(service)) {
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
          const defaults = CATALOG_MODULE_DEFAULTS[moduleKey];
          selected.set(moduleKey, {
            module_key: moduleKey,
            label: text(candidate.label ?? candidate.descricao ?? candidate.description ?? candidate.name ?? candidate.nome ?? service, moduleKey),
            endpoint,
            cost_cents: costCents,
            balance_cents: null,
            source: 'apibrasil',
            entity: defaults?.entity ?? null,
            key_type: defaults?.keyType ?? null,
            mode: defaults?.mode ?? 'basic',
            dataset_key: null,
            service_name: service || defaults?.serviceName || null,
            active: true,
            managed_by: 'catalog',
            menu_order: defaults?.menuOrder ?? 100,
            payload_json: { ...candidate, service_name: service },
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  for (const [moduleKey, row] of await fetchVerificaModules(alerts)) {
    selected.set(moduleKey, row);
  }

  const managedByAdmin = new Set(
    (await store.select('api_modules', { limit: 500 }))
      .filter((row) => row.managed_by === 'admin')
      .map((row) => String(row.module_key)),
  );
  for (const moduleKey of managedByAdmin) {
    if (selected.delete(moduleKey)) {
      alerts.push(`Módulo ${moduleKey} gerenciado pelo administrador; sincronização automática ignorada`);
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
  if (hasApiBrasil && config.apiBrasil.accountUrl) {
    try {
      const account = await fetchJson(config.apiBrasil.accountUrl, apiBrasilHeaders(), 'APIBrasil');
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
