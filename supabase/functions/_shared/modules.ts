import type { Row, Store } from './types.ts';

export const MODULE_ENTITIES = ['PF', 'EMPRESA', 'TELEFONE', 'VEICULO', 'VEICULO_FROTA'];
export const MODULE_SOURCES = ['verifica-online', 'apibrasil'];

const KEY_TYPES: Record<string, string[]> = {
  PF: ['cpf'],
  EMPRESA: ['cnpj'],
  TELEFONE: ['telefone'],
  VEICULO: ['placa', 'renavam', 'cpf'],
  VEICULO_FROTA: ['cpf'],
};

export interface CatalogModuleDefault {
  entity: string;
  keyType: string;
  mode: 'basic' | 'full';
  datasetKey: string;
  serviceName: string;
  menuOrder: number;
}

export const CATALOG_MODULE_DEFAULTS: Record<string, CatalogModuleDefault> = {
  'pf-cpf': { entity: 'PF', keyType: 'cpf', mode: 'basic', datasetKey: 'cpf_dados_completos', serviceName: 'dados-cadastrais', menuOrder: 10 },
  cnpj: { entity: 'EMPRESA', keyType: 'cnpj', mode: 'basic', datasetKey: 'cnpj_dados_basicos', serviceName: 'cnpj', menuOrder: 20 },
  telefone: { entity: 'TELEFONE', keyType: 'telefone', mode: 'basic', datasetKey: '', serviceName: 'cpf-cnpj-pelo-telefone', menuOrder: 30 },
  'placa-basica': { entity: 'VEICULO', keyType: 'placa', mode: 'basic', datasetKey: 'consulta_placa', serviceName: 'consulta-placa', menuOrder: 40 },
  'placa-completa': { entity: 'VEICULO', keyType: 'placa', mode: 'full', datasetKey: 'veicular_completa', serviceName: 'placa-completa', menuOrder: 50 },
  'frota-cpf': { entity: 'VEICULO_FROTA', keyType: 'cpf', mode: 'basic', datasetKey: '', serviceName: 'frota-pf', menuOrder: 60 },
  renavam: { entity: 'VEICULO', keyType: 'renavam', mode: 'full', datasetKey: '', serviceName: 'frota-pf', menuOrder: 70 },
};

function text(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value).trim();
}

function slugify(value: unknown): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function datasetSlug(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function endpointPath(value: unknown): string {
  const raw = text(value);
  if (!raw) {
    return '';
  }
  if (raw.startsWith('/')) {
    return raw.replace(/\/+$/, '');
  }
  try {
    return new URL(raw).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function datasetFromEndpoint(endpoint: string): string {
  const match = endpoint.match(/^\/datasets\/([a-z0-9_-]+)\/queries$/i);
  return match ? match[1].toLowerCase() : '';
}

function integer(value: unknown, name: string, required = false): number | null {
  if (value === null || value === undefined || value === '') {
    if (required) {
      throw new Error(`${name} é obrigatório`);
    }
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} inválido`);
  }
  return parsed;
}

export function normalizeModuleInput(payload: Row): Row {
  const moduleKey = slugify(payload.module_key ?? payload.label);
  if (!/^[a-z0-9-]{3,50}$/.test(moduleKey)) {
    throw new Error('Chave do módulo inválida');
  }
  const label = text(payload.label, moduleKey);
  const entity = text(payload.entity).toUpperCase();
  const keyType = text(payload.key_type ?? payload.keyType).toLowerCase();
  if (!MODULE_ENTITIES.includes(entity)) {
    throw new Error('Entidade inválida');
  }
  if (!KEY_TYPES[entity].includes(keyType)) {
    throw new Error('Tipo de chave inválido para a entidade');
  }
  const mode = text(payload.mode, 'basic').toLowerCase() === 'full' ? 'full' : 'basic';
  const source = text(payload.source, 'apibrasil').toLowerCase();
  if (!MODULE_SOURCES.includes(source)) {
    throw new Error('Provedor inválido');
  }
  const costCents = integer(payload.cost_cents ?? payload.costCents, 'Custo em centavos', true);
  if (!costCents || costCents <= 0) {
    throw new Error('Custo em centavos deve ser maior que zero');
  }
  let datasetKey = datasetSlug(payload.dataset_key ?? payload.datasetKey);
  if (!datasetKey) {
    datasetKey = datasetFromEndpoint(endpointPath(payload.endpoint)) || defaultDataset(moduleKey, entity, keyType, mode) || '';
  }
  let endpoint = endpointPath(payload.endpoint);
  if (source === 'verifica-online') {
    if (!datasetKey) {
      throw new Error('Dataset da Verifica Online é obrigatório');
    }
    endpoint = `/datasets/${datasetKey}/queries`;
  } else if (!endpoint) {
    throw new Error('Endpoint da APIBrasil é obrigatório');
  }
  const serviceName = text(payload.service_name ?? payload.serviceName, serviceNameDefault(moduleKey, keyType, source));
  const active = payload.active !== false && payload.active !== 'false';
  const menuOrder = integer(payload.menu_order ?? payload.menuOrder, 'Ordem no menu') ?? 100;
  return {
    module_key: moduleKey,
    label,
    entity,
    key_type: keyType,
    mode,
    source,
    dataset_key: source === 'verifica-online' ? datasetKey : datasetKey || null,
    service_name: serviceName || null,
    endpoint,
    cost_cents: costCents,
    active,
    managed_by: 'admin',
    menu_order: menuOrder,
    payload_json: {
      dataset_key: datasetKey || null,
      service_name: serviceName || null,
      entity,
      key_type: keyType,
      mode,
    },
    updated_at: new Date().toISOString(),
  };
}

function defaultDataset(moduleKey: string, entity: string, keyType: string, mode: string): string {
  if (CATALOG_MODULE_DEFAULTS[moduleKey]?.datasetKey) {
    return CATALOG_MODULE_DEFAULTS[moduleKey].datasetKey;
  }
  if (entity === 'PF' && keyType === 'cpf') {
    return 'cpf_dados_completos';
  }
  if (entity === 'EMPRESA' && keyType === 'cnpj') {
    return 'cnpj_dados_basicos';
  }
  if (entity === 'VEICULO' && keyType === 'placa') {
    return mode === 'full' ? 'veicular_completa' : 'consulta_placa';
  }
  return '';
}

function serviceNameDefault(moduleKey: string, keyType: string, source: string): string {
  const configured = CATALOG_MODULE_DEFAULTS[moduleKey]?.serviceName ?? '';
  if (source === 'verifica-online') {
    return configured || keyType;
  }
  return configured || keyType;
}

export interface ActiveModule {
  moduleKey: string;
  label: string;
  entity: string;
  keyType: string;
  mode: 'basic' | 'full';
  source: string;
  datasetKey: string;
  serviceName: string;
  endpoint: string;
  costCents: number;
}

export async function activeModules(store: Store): Promise<ActiveModule[]> {
  const rows = await store.select('api_modules', { limit: 500 });
  return rows
    .filter((row) => row.active !== false)
    .filter((row) => MODULE_ENTITIES.includes(text(row.entity).toUpperCase()))
    .filter((row) => KEY_TYPES[text(row.entity).toUpperCase()]?.includes(text(row.key_type).toLowerCase()))
    .map((row) => ({
      moduleKey: String(row.module_key),
      label: text(row.label, String(row.module_key)),
      entity: text(row.entity).toUpperCase(),
      keyType: text(row.key_type).toLowerCase(),
      mode: (text(row.mode, 'basic').toLowerCase() === 'full' ? 'full' : 'basic') as 'basic' | 'full',
      source: text(row.source, 'apibrasil'),
      datasetKey: text(row.dataset_key),
      serviceName: text(row.service_name),
      endpoint: text(row.endpoint),
      costCents: Math.max(0, Number.parseInt(String(row.cost_cents ?? 0), 10) || 0),
    }))
    .sort((left, right) => left.entity.localeCompare(right.entity) || left.label.localeCompare(right.label, 'pt-BR'));
}
