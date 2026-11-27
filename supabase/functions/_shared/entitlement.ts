import type { Row, Store } from './types.ts';

export async function isEntitled(_store: Store, user: Row | null): Promise<boolean> {
  if (!user || user.status === 'blocked') {
    return false;
  }
  return Number.parseInt(String(user.wallet_balance_cents ?? 0), 10) > 0;
}
