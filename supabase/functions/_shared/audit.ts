import type { Row, Store } from './types.ts';

export async function logAction(
  store: Store,
  input: { actorUserId?: string | null; action: string; targetType?: string | null; targetId?: string | null; metadata?: Row },
): Promise<void> {
  await store.insert('audit_logs', {
    actor_user_id: input.actorUserId ?? null,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    metadata_json: input.metadata ?? {},
    created_at: new Date().toISOString(),
  });
}
