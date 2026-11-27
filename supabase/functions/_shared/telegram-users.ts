import { logAction } from './audit.ts';
import type { Row, Store } from './types.ts';

export interface TelegramIdentity {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
}

export async function findWalletUserByTelegram(store: Store, telegramId: string | number): Promise<Row | null> {
  const id = String(telegramId);
  const link = await store.selectOne('user_telegram_accounts', { eq: { telegram_id: id } });
  if (link) {
    return store.selectById('users', String(link.user_id));
  }
  return store.selectOne('users', { eq: { telegram_id: id } });
}

export async function linkTelegramAccount(
  store: Store,
  telegramId: string | number,
  userId: string,
  username?: string | null,
): Promise<void> {
  await store.upsert('user_telegram_accounts', {
    telegram_id: String(telegramId),
    user_id: userId,
    username: username ?? null,
    updated_at: new Date().toISOString(),
  }, 'telegram_id');
}

export async function resolveOrCreateWalletUser(store: Store, identity: TelegramIdentity): Promise<Row> {
  const telegramId = String(identity.id);
  const existing = await findWalletUserByTelegram(store, telegramId);
  if (existing) {
    if (identity.username) {
      const link = await store.selectOne('user_telegram_accounts', { eq: { telegram_id: telegramId } });
      if (link && link.username !== identity.username) {
        await store.update('user_telegram_accounts', telegramId, {
          username: identity.username,
          updated_at: new Date().toISOString(),
        }, 'telegram_id');
      }
      if (existing.username !== identity.username) {
        return (await store.update('users', String(existing.id), { username: identity.username })) ?? existing;
      }
    }
    await linkTelegramAccount(store, telegramId, String(existing.id), identity.username);
    return existing;
  }

  const user = await store.insert('users', {
    telegram_id: telegramId,
    username: identity.username ?? null,
    name: [identity.first_name, identity.last_name].filter(Boolean).join(' '),
    role: 'user',
    status: 'pending',
    created_at: new Date().toISOString(),
  });
  await linkTelegramAccount(store, telegramId, String(user.id), identity.username);
  await logAction(store, {
    actorUserId: user.id,
    action: 'telegram.user.created',
    targetType: 'user',
    targetId: user.id,
  });
  return user;
}
