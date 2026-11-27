import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

loadEnv({ path: '../.env' });
loadEnv();

type Row = Record<string, any>;

interface EncryptionKey {
  id: string;
  secret: Buffer;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} é obrigatório para a migração`);
  }
  return value;
}

function uuidFor(collection: string, sourceId: string): string {
  const digest = createHash('sha256').update(`bot-consulta:${collection}:${sourceId}`).digest().subarray(0, 16);
  const bytes = Buffer.from(digest);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && typeof (value as Row).toDate === 'function') {
    return (value as Row).toDate().toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return null;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fernetKeys(): Buffer[] {
  const values = [required('FERNET_KEY'), ...(process.env.FERNET_PREVIOUS_KEYS ?? '').split(',').map((item) => item.trim()).filter(Boolean)];
  return values.map((value) => {
    const key = Buffer.from(value, 'base64url');
    if (key.length !== 32) {
      throw new Error('FERNET_KEY inválido: esperados 32 bytes em base64url');
    }
    return key;
  });
}

function decryptFernet(token: string, keys: Buffer[]): string | null {
  try {
    const data = Buffer.from(token, 'base64url');
    if (data.length < 57 || data[0] !== 0x80) {
      return null;
    }
    const signed = data.subarray(0, data.length - 32);
    const provided = data.subarray(data.length - 32);
    for (const key of keys) {
      const expected = createHmac('sha256', key.subarray(0, 16)).update(signed).digest();
      if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
        const decipher = createDecipheriv('aes-128-cbc', key.subarray(16, 32), data.subarray(9, 25));
        return Buffer.concat([decipher.update(data.subarray(25, data.length - 32)), decipher.final()]).toString('utf8');
      }
    }
  } catch {
    return null;
  }
  return null;
}

function encryptionKeys(): EncryptionKey[] {
  const configured: EncryptionKey[] = [];
  if (process.env.ENCRYPTION_KEYS) {
    try {
      const parsed = JSON.parse(process.env.ENCRYPTION_KEYS) as Array<{ id?: string; secret?: string }>;
      for (const item of parsed) {
        if (!item.secret) {
          continue;
        }
        const decoded = Buffer.from(item.secret, 'base64');
        const secret = decoded.length === 32 ? decoded : createHash('sha256').update(item.secret).digest();
        configured.push({ id: String(item.id ?? 'v2'), secret });
      }
    } catch {
      throw new Error('ENCRYPTION_KEYS deve ser um JSON array de objetos { id, secret }');
    }
  }
  if (configured.length === 0) {
    const fallback = process.env.FERNET_KEY || required('SECRET_KEY');
    const decoded = Buffer.from(fallback, 'base64url');
    configured.push({
      id: 'v2',
      secret: decoded.length === 32 ? decoded : createHash('sha256').update(fallback).digest(),
    });
  }
  return configured;
}

function encryptV2(value: string, key: EncryptionKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.secret, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(value, 'utf8')), cipher.final()]);
  const payload = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return `v2:${key.id}:${iv.toString('base64')}:${payload.toString('base64')}`;
}

function reencrypt(value: unknown, fernet: Buffer[], keys: EncryptionKey[]): string | null {
  if (!value) {
    return null;
  }
  const text = typeof value === 'string' ? value : String(value);
  if (text.startsWith('v2:')) {
    return text;
  }
  const plain = decryptFernet(text, fernet);
  if (plain === null) {
    console.warn('Não foi possível descriptografar um registro; ele será ignorado.');
    return null;
  }
  return encryptV2(plain, keys[0]!);
}

async function loadCollection(db: ReturnType<typeof getFirestore>, name: string): Promise<Array<{ id: string; data: Row }>> {
  const snapshot = await db.collection(name).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() as Row }));
}

async function upsertBatch(client: SupabaseClient, table: string, rows: Row[], onConflict: string): Promise<void> {
  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200);
    const { error } = await client.from(table).upsert(batch, { onConflict });
    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
  }
}

async function main(): Promise<void> {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const app = getApps()[0] ?? initializeApp(
    serviceAccountJson ? { credential: cert(JSON.parse(serviceAccountJson) as any) } : undefined,
  );
  const db = getFirestore(app);
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fernet = fernetKeys();
  const keys = encryptionKeys();

  const collections: Record<string, Array<{ id: string; data: Row }>> = {};
  for (const name of [
    'users', 'plans', 'subscriptions', 'payments', 'queries', 'query_results', 'query_cache',
    'audit_logs', 'bot_sessions', 'dsr_requests', 'rate_limits', 'app_settings',
  ]) {
    collections[name] = await loadCollection(db, name);
    console.log(`${name}: ${collections[name]!.length} registros no Firestore`);
  }

  const ref = (collection: string, id: unknown): string | null => (id ? uuidFor(collection, String(id)) : null);

  const users = collections.users!.map(({ id, data }) => ({
    id: uuidFor('users', id),
    legacy_id: id,
    telegram_id: data.telegram_id ? integer(data.telegram_id, null as any) : null,
    username: data.username ?? null,
    name: data.name ?? null,
    email: data.email ?? null,
    auth_user_id: null,
    password_hash: data.password_hash ?? null,
    role: ['admin', 'user'].includes(String(data.role)) ? data.role : 'user',
    status: ['active', 'blocked', 'pending'].includes(String(data.status)) ? data.status : 'pending',
    consent_version: data.consent_version ?? null,
    consent_at: iso(data.consent_at),
    legal_basis: data.legal_basis ?? null,
    anonymized_at: iso(data.anonymized_at),
    created_at: iso(data.created_at) ?? new Date().toISOString(),
  }));

  const plans = collections.plans!.map(({ id, data }) => ({
    id: uuidFor('plans', id),
    legacy_id: id,
    name: data.name ?? 'Plano',
    price_cents: integer(data.price_cents),
    period_days: integer(data.period_days, 30),
    active: data.active !== false,
    queries_per_day: integer(data.limits?.queries_per_day, 100),
    created_at: iso(data.created_at) ?? new Date().toISOString(),
  }));

  const subscriptions = collections.subscriptions!.map(({ id, data }) => ({
    id: uuidFor('subscriptions', id),
    legacy_id: id,
    user_id: ref('users', data.user_id),
    plan_id: ref('plans', data.plan_id),
    source: data.source ?? null,
    status: ['active', 'past_due', 'canceled', 'expired'].includes(String(data.status)) ? data.status : 'expired',
    starts_at: iso(data.starts_at),
    ends_at: iso(data.ends_at),
    external_ref: data.external_ref ?? null,
    payment_id: data.payment_id ?? null,
    created_at: iso(data.created_at) ?? new Date().toISOString(),
  }));

  const payments = collections.payments!.map(({ id, data }) => ({
    id: uuidFor('payments', id),
    legacy_id: id,
    user_id: ref('users', data.user_id),
    plan_id: ref('plans', data.plan_id),
    subscription_id: ref('subscriptions', data.subscription_id),
    provider: data.provider ?? null,
    amount_cents: integer(data.amount_cents),
    status: ['pending', 'paid', 'failed', 'manual'].includes(String(data.status)) ? data.status : 'pending',
    external_id: data.external_id ?? null,
    external_reference: data.external_reference ?? null,
    preference_id: data.preference_id ?? null,
    checkout_url: data.checkout_url ?? null,
    mercadopago_payment_id: data.mercadopago_payment_id ?? null,
    payload_json: data.payload_json ?? null,
    expires_at: iso(data.expires_at),
    updated_at: iso(data.updated_at),
    error: data.error ?? null,
    created_at: iso(data.created_at) ?? new Date().toISOString(),
  }));

  const queries = collections.queries!.map(({ id, data }) => ({
    id: uuidFor('queries', id),
    legacy_id: id,
    user_id: ref('users', data.user_id),
    entity: data.entity ?? '',
    key_type: data.key_type ?? '',
    key_hash: data.key_hash ?? '',
    key_masked: data.key_masked ?? null,
    provider: data.provider ?? null,
    status: ['pending', 'completed', 'failed'].includes(String(data.status)) ? data.status : 'failed',
    cost_cents: integer(data.cost_cents),
    error: data.error ?? null,
    created_at: iso(data.created_at) ?? new Date().toISOString(),
  }));

  const queryResults = collections.query_results!.map(({ id, data }) => ({
    query_id: uuidFor('queries', id),
    raw_encrypted: reencrypt(data.raw_encrypted_json, fernet, keys),
    normalized_json: data.normalized_json ?? null,
    fetched_at: iso(data.fetched_at),
  }));

  const queryCache = collections.query_cache!.map(({ id, data }) => ({
    key_hash: id,
    entity: data.entity ?? '',
    key_type: data.key_type ?? '',
    raw_encrypted: reencrypt(data.raw_encrypted_json, fernet, keys),
    normalized_json: data.normalized_json ?? null,
    is_mock: data.mock === true,
    expires_at: iso(data.expires_at),
    created_at: iso(data.created_at) ?? new Date().toISOString(),
  }));

  const auditLogs = collections.audit_logs!.map(({ id, data }) => ({
    id: uuidFor('audit_logs', id),
    legacy_id: id,
    actor_user_id: ref('users', data.actor_user_id),
    action: data.action ?? '',
    target_type: data.target_type ?? null,
    target_id: data.target_id ?? null,
    metadata_json: data.metadata_json ?? null,
    created_at: iso(data.created_at) ?? new Date().toISOString(),
  }));

  const botSessions = collections.bot_sessions!.map(({ id, data }) => ({
    id,
    telegram_id: data.telegram_id ? integer(data.telegram_id, null as any) : null,
    state: data.state ?? null,
    data: data.data ?? null,
    updated_at: iso(data.updated_at),
  }));

  const dsrRequests = collections.dsr_requests!.map(({ id, data }) => ({
    id: uuidFor('dsr_requests', id),
    legacy_id: id,
    user_id: ref('users', data.user_id),
    status: ['pending', 'done', 'rejected'].includes(String(data.status)) ? data.status : 'pending',
    resolved_at: iso(data.resolved_at),
    resolved_by: ref('users', data.resolved_by),
    created_at: iso(data.created_at) ?? new Date().toISOString(),
  }));

  const rateLimits = collections.rate_limits!.map(({ id, data }) => ({
    id,
    scope: data.scope ?? '',
    identity: data.identity ?? '',
    count: integer(data.count),
    expires_at: iso(data.expires_at),
  }));

  const sourceSettings = collections.app_settings!.find((item) => item.id === 'main')?.data ?? {};
  const appSettings = [{
    id: 'main',
    query_cache_ttl_seconds: integer(sourceSettings.query_cache_ttl_seconds, 300),
    raw_retention_days: integer(sourceSettings.raw_retention_days, 90),
    queries_per_minute: integer(sourceSettings.queries_per_minute, 10),
    consent_version: sourceSettings.consent_version ?? 'v1',
    updated_at: iso(sourceSettings.updated_at),
  }];

  const batches: Array<[string, Row[], string]> = [
    ['users', users, 'legacy_id'],
    ['plans', plans, 'legacy_id'],
    ['subscriptions', subscriptions, 'legacy_id'],
    ['payments', payments, 'legacy_id'],
    ['queries', queries, 'legacy_id'],
    ['query_results', queryResults, 'query_id'],
    ['query_cache', queryCache, 'key_hash'],
    ['audit_logs', auditLogs, 'legacy_id'],
    ['bot_sessions', botSessions, 'id'],
    ['dsr_requests', dsrRequests, 'legacy_id'],
    ['rate_limits', rateLimits, 'id'],
    ['app_settings', appSettings, 'id'],
  ];

  for (const [table, rows, onConflict] of batches) {
    await upsertBatch(client, table, rows, onConflict);
    console.log(`${table}: ${rows.length} registros gravados`);
  }

  for (const [table] of batches) {
    const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
    console.log(`${table}: ${count} registros no Postgres`);
  }
  console.log('Migração concluída.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
