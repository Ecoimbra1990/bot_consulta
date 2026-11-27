import type { Row, Store } from './types.ts';

export async function getActiveSubscription(store: Store, userId: string): Promise<Row | null> {
  const now = Date.now();
  const subscriptions = await store.select('subscriptions', {
    eq: { user_id: userId, status: 'active' },
    order: { column: 'ends_at', ascending: false },
    limit: 20,
  });
  for (const subscription of subscriptions) {
    const endsAt = subscription.ends_at ? new Date(subscription.ends_at).getTime() : Number.NaN;
    if (Number.isFinite(endsAt) && endsAt >= now) {
      return subscription;
    }
  }
  return null;
}

export async function isEntitled(store: Store, user: Row | null): Promise<boolean> {
  if (!user || user.status !== 'active') {
    return false;
  }
  return (await getActiveSubscription(store, String(user.id))) !== null;
}
