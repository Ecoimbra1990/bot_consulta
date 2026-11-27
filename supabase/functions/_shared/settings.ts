import { config } from './env.ts';
import type { Row, RuntimeSettings, Store } from './types.ts';

const DOC_ID = 'main';

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getRuntimeSettings(store: Store): Promise<RuntimeSettings> {
  const row = await store.selectById('app_settings', DOC_ID);
  const data: Row = row ?? {};
  return {
    query_cache_ttl_seconds: positiveInt(data.query_cache_ttl_seconds, config.queryCacheTtlSeconds),
    raw_retention_days: positiveInt(data.raw_retention_days, config.rawRetentionDays),
    queries_per_minute: positiveInt(data.queries_per_minute, config.queriesPerMinute),
    consent_version: String(data.consent_version || config.consentVersion),
  };
}

export async function updateRuntimeSettings(store: Store, values: Row): Promise<RuntimeSettings> {
  const current = await getRuntimeSettings(store);
  for (const key of ['query_cache_ttl_seconds', 'raw_retention_days', 'queries_per_minute'] as const) {
    const raw = values[key];
    if (raw !== undefined && raw !== null && raw !== '') {
      current[key] = positiveInt(raw, current[key]);
    }
  }
  if (values.consent_version) {
    current.consent_version = String(values.consent_version).trim();
  }
  await store.upsert('app_settings', { id: DOC_ID, ...current, updated_at: new Date().toISOString() });
  return current;
}
