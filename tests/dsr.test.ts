import { describe, expect, it } from 'vitest';
import { encryptText } from '../supabase/functions/_shared/crypto.ts';
import { acceptConsent, exportUserData, hasConsent, purgeExpiredRaw, requestDeletion, resolveDeletion } from '../supabase/functions/_shared/dsr.ts';
import { getRuntimeSettings } from '../supabase/functions/_shared/settings.ts';
import { MemoryStore } from './helpers/memory-store.ts';

describe('LGPD / DSR', () => {
  it('registra consentimento e bloqueia usuário sem consentimento vigente', async () => {
    const store = new MemoryStore();
    await store.insert('users', { id: 'u1', status: 'active', consent_version: null });
    expect(await hasConsent(store, await store.selectById('users', 'u1'))).toBe(false);
    await acceptConsent(store, 'u1');
    expect(await hasConsent(store, await store.selectById('users', 'u1'))).toBe(true);
  });

  it('exporta dados descriptografando resultados', async () => {
    const store = new MemoryStore();
    await store.insert('users', { id: 'u1', status: 'active' });
    const query = await store.insert('queries', { user_id: 'u1', entity: 'PF', key_type: 'cpf' });
    await store.upsert('query_results', {
      query_id: query.id,
      raw_encrypted: await encryptText(JSON.stringify({ nome: 'PESSOA EXEMPLO' })),
    }, 'query_id');
    const exported = await exportUserData(store, 'u1');
    expect(exported.queries[0].raw).toEqual({ nome: 'PESSOA EXEMPLO' });
  });

  it('purga resultados brutos expirados', async () => {
    const store = new MemoryStore();
    await store.upsert('query_results', { query_id: 'q1', fetched_at: new Date(Date.now() - 10 * 86_400_000).toISOString() }, 'query_id');
    await store.upsert('query_results', { query_id: 'q2', fetched_at: new Date().toISOString() }, 'query_id');
    expect(await purgeExpiredRaw(store, 1)).toBe(1);
    expect(await store.count('query_results')).toBe(1);
  });

  it('anonymiza usuário ao aprovar exclusão', async () => {
    const store = new MemoryStore();
    const user = await store.insert('users', { id: 'u1', telegram_id: 123, name: 'Joao', email: 'joao@example.local', status: 'active' });
    await store.insert('bot_sessions', { id: 's1', telegram_id: 123 });
    const request = await requestDeletion(store, String(user.id));
    const settings = await getRuntimeSettings(store);
    const resolved = await resolveDeletion(store, { requestId: String(request.id), actorUserId: 'admin', approve: true });
    expect(resolved.status).toBe('done');
    const updated = await store.selectById('users', String(user.id));
    expect(updated?.status).toBe('blocked');
    expect(updated?.name).toBeNull();
    expect(updated?.email).toBeNull();
    expect(updated?.anonymized_at).toBeTruthy();
    expect(settings.consent_version).toBeTruthy();
    expect(await store.count('bot_sessions')).toBe(0);
  });
});
