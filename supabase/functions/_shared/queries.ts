import { encryptText, sha256Hex } from './crypto.ts';
import * as validators from './validators.ts';
import { onlyDigits } from './validators.ts';
import { maskCnpj, maskCpf, maskPhone, maskPlate } from './masking.ts';
import { checkRateLimit } from './rate-limit.ts';
import { APIBrasilAdapter } from './provider.ts';
import { assertSafeMargin, resolvePrice, type QueryMode, type ResolvedPrice } from './pricing.ts';
import { getRuntimeSettings } from './settings.ts';
import type { ProviderResult, Row, Store } from './types.ts';
import { creditWallet, debitWallet, InsufficientBalanceError } from './wallet.ts';

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

async function callProvider(
  provider: APIBrasilAdapter,
  entity: string,
  keyType: string,
  keyValue: string,
  mode: QueryMode,
  price: ResolvedPrice,
): Promise<ProviderResult> {
  const options = { serviceName: price.serviceName, path: price.endpoint };
  if (entity === 'PF') {
    return provider.queryPfCpf(keyValue, options);
  }
  if (entity === 'EMPRESA') {
    return provider.queryCompanyCnpj(keyValue, options);
  }
  if (entity === 'TELEFONE') {
    return provider.queryPhone(keyValue, options);
  }
  if (keyType === 'placa') {
    return provider.queryVehiclePlate(keyValue, mode === 'full', options);
  }
  if (keyType === 'renavam') {
    throw new Error('Consulta por Renavam exige o CPF do proprietário');
  }
  return provider.queryVehicleByCpf(keyValue, options);
}

export interface RunQueryInput {
  userId: string;
  entity: string;
  keyType: string;
  keyValue: string;
  mode?: QueryMode;
  provider?: APIBrasilAdapter;
}

export async function runQuery(store: Store, input: RunQueryInput): Promise<Row> {
  const mode = input.mode ?? 'basic';
  const { entity, keyType, keyValue } = validate(input.entity, input.keyType, input.keyValue);
  if (!(await checkRateLimit(store, 'query', input.userId))) {
    throw new PermissionError('Limite de consultas por minuto excedido');
  }
  const keyHash = await sha256Hex(`${entity}:${keyType}:${mode}:${keyValue}`);
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
      charged_cents: 0,
      module_key: cached.module_key ?? null,
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

  const price = await resolvePrice(store, entity, keyType, mode);
  assertSafeMargin(price);

  const query = await store.insert('queries', {
    user_id: input.userId,
    entity,
    key_type: keyType,
    key_hash: keyHash,
    key_masked: maskKey(keyType, keyValue),
    provider: null,
    status: 'pending',
    cost_cents: price.costCents,
    charged_cents: price.priceCents,
    module_key: price.moduleKey,
    error: null,
    created_at: now,
  });

  try {
    await debitWallet(store, {
      userId: input.userId,
      amountCents: price.priceCents,
      reference: `query:${query.id}`,
      description: `Consulta ${price.moduleKey}`,
      metadata: { query_id: query.id, module_key: price.moduleKey, mode },
    });
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      await store.update('queries', query.id, { status: 'failed', error: error.message, charged_cents: 0 });
    }
    throw error;
  }

  const refund = async (reason: string): Promise<Row> => {
    try {
      await creditWallet(store, {
        userId: input.userId,
        amountCents: price.priceCents,
        reference: `refund:${query.id}`,
        description: 'Estorno de consulta não concluída',
        metadata: { query_id: query.id, reason },
      }, 'refund');
    } catch {
      return (await store.selectById('queries', query.id)) ?? query;
    }
    return (await store.update('queries', query.id, {
      status: 'failed',
      error: reason,
      charged_cents: 0,
      provider: null,
    })) ?? query;
  };

  let result: ProviderResult;
  try {
    result = await callProvider(input.provider ?? new APIBrasilAdapter(), entity, keyType, keyValue, mode, price);
  } catch (error) {
    return refund(error instanceof Error ? error.message : 'Falha de comunicação com a APIBrasil');
  }
  if (!result.ok) {
    return refund(result.error || 'Erro na APIBrasil');
  }

  const rawEncrypted = await encryptText(JSON.stringify(result.raw));
  await store.upsert(
    'query_results',
    { query_id: query.id, raw_encrypted: rawEncrypted, normalized_json: result.normalized, fetched_at: now },
    'query_id',
  );
  await store.update('queries', query.id, {
    status: 'completed',
    provider: result.provider,
    cost_cents: result.cost_cents || price.costCents,
    charged_cents: price.priceCents,
    module_key: price.moduleKey,
    error: null,
  });
  if (!result.raw?.mock) {
    const settings = await getRuntimeSettings(store);
    await store.upsert(
      'query_cache',
      {
        key_hash: keyHash,
        entity,
        key_type: keyType,
        module_key: price.moduleKey,
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
