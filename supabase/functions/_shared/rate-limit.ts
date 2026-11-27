import { getRuntimeSettings } from './settings.ts';
import type { Store } from './types.ts';

export async function checkRateLimit(store: Store, scope: string, identity: string, limit?: number): Promise<boolean> {
  const resolved = limit ?? (await getRuntimeSettings(store)).queries_per_minute;
  return Boolean(await store.rpc('rate_limit_check', { p_scope: scope, p_identity: identity, p_limit: resolved }));
}
