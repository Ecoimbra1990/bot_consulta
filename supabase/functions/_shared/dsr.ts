import { logAction } from './audit.ts';
import { decryptText } from './crypto.ts';
import { getRuntimeSettings } from './settings.ts';
import type { Row, Store } from './types.ts';

export async function hasConsent(store: Store, user: Row | null): Promise<boolean> {
  if (!user || user.status === 'blocked') {
    return false;
  }
  const settings = await getRuntimeSettings(store);
  return user.consent_version === settings.consent_version;
}

export async function acceptConsent(store: Store, userId: string): Promise<void> {
  const settings = await getRuntimeSettings(store);
  const now = new Date().toISOString();
  await store.update('users', userId, {
    consent_version: settings.consent_version,
    consent_at: now,
    legal_basis: 'contract',
  });
  await logAction(store, {
    actorUserId: userId,
    action: 'consent.accepted',
    targetType: 'user',
    targetId: userId,
    metadata: { version: settings.consent_version, legal_basis: 'contract' },
  });
}

export async function exportUserData(store: Store, userId: string): Promise<Row> {
  const user = await store.selectById('users', userId);
  if (!user) {
    throw new Error('Usuário não encontrado');
  }
  const queries = await store.select('queries', { eq: { user_id: userId }, limit: 200 });
  const details: Row[] = [];
  for (const query of queries) {
    const result = await store.selectById('query_results', query.id, 'query_id');
    let raw: Row | null = null;
    if (result?.raw_encrypted) {
      try {
        const text = await decryptText(result.raw_encrypted);
        raw = text ? (JSON.parse(text) as Row) : null;
      } catch {
        raw = null;
      }
    }
    details.push({ query, result, raw });
  }
  return {
    user,
    subscriptions: await store.select('subscriptions', { eq: { user_id: userId }, limit: 200 }),
    payments: await store.select('payments', { eq: { user_id: userId }, limit: 200 }),
    queries: details,
    audit: await store.select('audit_logs', { eq: { actor_user_id: userId }, limit: 200 }),
  };
}

export async function requestDeletion(store: Store, userId: string): Promise<Row> {
  const request = await store.insert('dsr_requests', {
    user_id: userId,
    status: 'pending',
    created_at: new Date().toISOString(),
  });
  await logAction(store, {
    actorUserId: userId,
    action: 'dsr.deletion_requested',
    targetType: 'dsr_request',
    targetId: request.id,
    metadata: {},
  });
  return request;
}

export async function listPendingRequests(store: Store): Promise<Row[]> {
  return store.select('dsr_requests', { eq: { status: 'pending' }, limit: 100 });
}

export async function resolveDeletion(
  store: Store,
  input: { requestId: string; actorUserId: string; approve: boolean },
): Promise<Row> {
  const request = await store.selectById('dsr_requests', input.requestId);
  if (!request) {
    throw new Error('Solicitação não encontrada');
  }
  if (request.status !== 'pending') {
    throw new Error('Solicitação já resolvida');
  }
  let status = 'rejected';
  if (input.approve) {
    const userId = String(request.user_id ?? '');
    const user = await store.selectById('users', userId);
    const telegramId = user?.telegram_id ?? null;
    const queries = await store.select('queries', { eq: { user_id: userId }, limit: 500 });
    for (const query of queries) {
      await store.remove('query_results', query.id, 'query_id');
      await store.update('queries', query.id, { key_hash: 'deleted', key_masked: '***' });
    }
    if (user) {
      await store.update('users', userId, {
        name: null,
        username: null,
        telegram_id: null,
        email: null,
        password_hash: null,
        consent_version: null,
        status: 'blocked',
        anonymized_at: new Date().toISOString(),
      });
    }
    if (telegramId !== null) {
      const sessions = await store.select('bot_sessions', { eq: { telegram_id: telegramId }, limit: 500 });
      for (const session of sessions) {
        await store.remove('bot_sessions', session.id);
      }
    }
    status = 'done';
  }
  const updated = await store.update('dsr_requests', input.requestId, {
    status,
    resolved_at: new Date().toISOString(),
    resolved_by: input.actorUserId,
  });
  await logAction(store, {
    actorUserId: input.actorUserId,
    action: 'dsr.deletion_resolved',
    targetType: 'dsr_request',
    targetId: input.requestId,
    metadata: { status },
  });
  return updated ?? { id: input.requestId, status };
}

export async function purgeExpiredRaw(store: Store, days?: number): Promise<number> {
  const settings = await getRuntimeSettings(store);
  const retentionDays = days ?? settings.raw_retention_days;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let count = 0;
  const results = await store.select('query_results', { order: { column: 'fetched_at', ascending: true }, limit: 5000 });
  for (const result of results) {
    const fetchedAt = result.fetched_at ? new Date(result.fetched_at).getTime() : Number.NaN;
    if (Number.isFinite(fetchedAt) && fetchedAt < cutoff) {
      await store.remove('query_results', result.query_id, 'query_id');
      count += 1;
    }
  }
  const cached = await store.select('query_cache', { order: { column: 'expires_at', ascending: true }, limit: 5000 });
  for (const item of cached) {
    const expiresAt = item.expires_at ? new Date(item.expires_at).getTime() : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      await store.remove('query_cache', item.key_hash, 'key_hash');
      count += 1;
    }
  }
  return count;
}
