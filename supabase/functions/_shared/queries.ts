import { encryptText, sha256Hex } from './crypto.ts';
import * as validators from './validators.ts';
import { onlyDigits } from './validators.ts';
import { maskCnpj, maskCpf, maskPhone, maskPlate } from './masking.ts';
import { checkRateLimit } from './rate-limit.ts';
import { APIBrasilAdapter } from './provider.ts';
import { getRuntimeSettings } from './settings.ts';
import type { Row, Store } from './types.ts';

function maskKey(keyType: string, value: string): string {
  if (keyType === 'cpf') {
    return maskCpf(value);
  }
  if (keyType === 'cnpj') {
    return maskCnpj(value);
  }
  if (keyType === 'placa') {
    return maskPlate(value);
  }
  if (keyType === 'telefone') {
    return maskPhone(value);
  }
  const digits = onlyDigits(value);
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '***';
}

function validate(entityInput: string, keyTypeInput: string, keyValueInput: string): { entity: string; keyType: string; keyValue: string } {
  const entity = String(entityInput || '').toUpperCase();
  const keyType = String(keyTypeInput || '').toLowerCase();
  let keyValue = String(keyValueInput || '').trim();
  const { isValidCpf, isValidCnpj, isValidPhone, isValidPlate, isValidRenavam, normalizePhone, normalizePlate } = validators;

  if (entity === 'PF') {
    if (keyType !== 'cpf' || !isValidCpf(keyValue)) {
      throw new Error('CPF inválido');
    }
    return { entity, keyType, keyValue: onlyDigits(keyValue) };
  }
  if (entity === 'EMPRESA') {
    if (keyType !== 'cnpj' || !isValidCnpj(keyValue)) {
      throw new Error('CNPJ inválido');
    }
    return { entity, keyType, keyValue: onlyDigits(keyValue) };
  }
  if (entity === 'TELEFONE') {
    if (keyType !== 'telefone' || !isValidPhone(keyValue)) {
      throw new Error('Telefone inválido');
    }
    return { entity, keyType, keyValue: normalizePhone(keyValue) };
  }
  if (entity === 'VEICULO') {
    if (keyType === 'placa') {
      keyValue = normalizePlate(keyValue);
      if (!isValidPlate(keyValue)) {
        throw new Error('Placa inválida');
      }
      return { entity, keyType, keyValue };
    }
    if (keyType === 'renavam') {
      keyValue = onlyDigits(keyValue);
      if (!isValidRenavam(keyValue)) {
        throw new Error('Renavam inválido');
      }
      return { entity, keyType, keyValue };
    }
    if (keyType === 'cpf') {
      keyValue = onlyDigits(keyValue);
      if (!isValidCpf(keyValue)) {
        throw new Error('CPF inválido');
      }
      return { entity, keyType, keyValue };
    }
    throw new Error('Tipo de consulta veicular inválido');
  }
  throw new Error('Entidade inválida');
}

async function callProvider(provider: APIBrasilAdapter, entity: string, keyType: string, keyValue: string): Promise<Row> {
  if (entity === 'PF') {
    return provider.queryPfCpf(keyValue);
  }
  if (entity === 'EMPRESA') {
    return provider.queryCompanyCnpj(keyValue);
  }
  if (entity === 'TELEFONE') {
    return provider.queryPhone(keyValue);
  }
  if (keyType === 'placa') {
    return provider.queryVehiclePlate(keyValue);
  }
  if (keyType === 'renavam') {
    throw new Error('Consulta por Renavam exige o CPF do proprietário');
  }
  return provider.queryVehicleByCpf(keyValue);
}

export interface RunQueryInput {
  userId: string;
  entity: string;
  keyType: string;
  keyValue: string;
  provider?: APIBrasilAdapter;
}

export async function runQuery(store: Store, input: RunQueryInput): Promise<Row> {
  const { entity, keyType, keyValue } = validate(input.entity, input.keyType, input.keyValue);
  if (!(await checkRateLimit(store, 'query', input.userId))) {
    throw new PermissionError('Limite de consultas por minuto excedido');
  }
  const keyHash = await sha256Hex(`${entity}:${keyType}:${keyValue}`);
  const now = new Date().toISOString();
  const cached = await store.selectById('query_cache', keyHash, 'key_hash');
  if (cached && !cached.is_mock && cached.expires_at && new Date(cached.expires_at).getTime() > Date.now()) {
    const query = await store.insert('queries', {
      user_id: input.userId,
      entity,
      key_type: keyType,
      key_hash: keyHash,
      key_masked: maskKey(keyType, keyValue),
      provider: 'cache',
      status: 'completed',
      cost_cents: 0,
      error: null,
      created_at: now,
    });
    await store.upsert(
      'query_results',
      {
        query_id: query.id,
        raw_encrypted: cached.raw_encrypted,
        normalized_json: cached.normalized_json,
        fetched_at: now,
      },
      'query_id',
    );
    return query;
  }

  const query = await store.insert('queries', {
    user_id: input.userId,
    entity,
    key_type: keyType,
    key_hash: keyHash,
    key_masked: maskKey(keyType, keyValue),
    provider: null,
    status: 'pending',
    cost_cents: 0,
    error: null,
    created_at: now,
  });

  const result = await callProvider(input.provider ?? new APIBrasilAdapter(), entity, keyType, keyValue);
  if (!result.ok) {
    await store.update('queries', query.id, { status: 'failed', error: result.error || 'Erro na APIBrasil', provider: result.provider });
    return (await store.selectById('queries', query.id)) ?? query;
  }

  const rawEncrypted = await encryptText(JSON.stringify(result.raw));
  await store.upsert(
    'query_results',
    { query_id: query.id, raw_encrypted: rawEncrypted, normalized_json: result.normalized, fetched_at: now },
    'query_id',
  );
  await store.update('queries', query.id, { status: 'completed', provider: result.provider, cost_cents: result.cost_cents, error: null });
  if (!result.raw?.mock) {
    const settings = await getRuntimeSettings(store);
    await store.upsert(
      'query_cache',
      {
        key_hash: keyHash,
        entity,
        key_type: keyType,
        raw_encrypted: rawEncrypted,
        normalized_json: result.normalized,
        is_mock: false,
        expires_at: new Date(Date.now() + settings.query_cache_ttl_seconds * 1000).toISOString(),
        created_at: now,
      },
      'key_hash',
    );
  }
  return (await store.selectById('queries', query.id)) ?? query;
}

export class PermissionError extends Error {}
