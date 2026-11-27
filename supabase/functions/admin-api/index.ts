import { createClient } from '@supabase/supabase-js';
import { activateManualSubscription } from '../_shared/billing.ts';
import { logAction } from '../_shared/audit.ts';
import { resolveDeletion } from '../_shared/dsr.ts';
import { updateRuntimeSettings } from '../_shared/settings.ts';
import { createStore } from '../_shared/store.ts';
import type { Row, Store } from '../_shared/types.ts';

interface AdminContext {
  store: Store;
  actorId: string;
  payload: Row;
}

type Handler = (context: AdminContext) => Promise<Row>;

async function createUser(context: AdminContext): Promise<Row> {
  const { store, payload } = context;
  const email = String(payload.email ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  if (!email || password.length < 12) {
    throw new Error('E-mail e senha com no mínimo 12 caracteres são obrigatórios');
  }
  const role = ['admin', 'user'].includes(String(payload.role)) ? String(payload.role) : 'user';
  const status = ['active', 'blocked', 'pending'].includes(String(payload.status)) ? String(payload.status) : 'pending';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
  });
  if (created.error) {
    throw new Error(created.error.message);
  }
  const authUserId = created.user?.id;
  if (!authUserId) {
    throw new Error('Falha ao criar usuário no Supabase Auth');
  }
  const user = await store.insert('users', {
    name: payload.name ?? null,
    telegram_id: payload.telegram_id ?? null,
    email,
    auth_user_id: authUserId,
    password_hash: null,
    role,
    status,
    created_at: new Date().toISOString(),
  });
  return user;
}

const handlers: Record<string, Handler> = {
  'user.create': async (context) => {
    const user = await createUser(context);
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'user.create',
      targetType: 'user',
      targetId: user.id,
      metadata: { role: user.role, status: user.status },
    });
    return user;
  },
  'user.updateStatus': async (context) => {
    const userId = String(context.payload.user_id ?? context.payload.userId ?? '');
    const status = String(context.payload.status ?? '');
    if (!['active', 'blocked', 'pending'].includes(status)) {
      throw new Error('Status inválido');
    }
    const updated = await context.store.update('users', userId, { status });
    if (!updated) {
      throw new Error('Usuário não encontrado');
    }
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'user.status.update',
      targetType: 'user',
      targetId: userId,
      metadata: { status },
    });
    return updated;
  },
  'subscription.manual': async (context) => {
    const days = Number.parseInt(String(context.payload.days ?? '30'), 10);
    const planId = context.payload.plan_id ?? context.payload.planId ?? null;
    const subscription = await activateManualSubscription(context.store, {
      userId: String(context.payload.user_id ?? context.payload.userId ?? ''),
      planId: planId ? String(planId) : null,
      days,
      actorUserId: context.actorId,
      note: context.payload.note ?? null,
    });
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'subscription.manual.activate',
      targetType: 'subscription',
      targetId: subscription.id,
      metadata: { days },
    });
    return subscription;
  },
  'plan.create': async (context) => {
    const name = String(context.payload.name ?? '').trim();
    const priceCents = Number.parseInt(String(context.payload.price_cents ?? context.payload.priceCents ?? '0'), 10);
    const periodDays = Number.parseInt(String(context.payload.period_days ?? context.payload.periodDays ?? '30'), 10);
    if (!name || !Number.isFinite(priceCents) || priceCents <= 0 || !Number.isFinite(periodDays) || periodDays <= 0) {
      throw new Error('Plano inválido');
    }
    const plan = await context.store.insert('plans', {
      name,
      price_cents: priceCents,
      period_days: periodDays,
      active: context.payload.active !== false && context.payload.active !== 'false',
      queries_per_day: 100,
      created_at: new Date().toISOString(),
    });
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'plan.create',
      targetType: 'plan',
      targetId: plan.id,
      metadata: {},
    });
    return plan;
  },
  'dsr.resolve': async (context) => {
    const requestId = String(context.payload.request_id ?? context.payload.requestId ?? '');
    const approve = context.payload.approve === true || context.payload.approve === 'true';
    const result = await resolveDeletion(context.store, { requestId, actorUserId: context.actorId, approve });
    return result;
  },
  'settings.update': async (context) => {
    const values = await updateRuntimeSettings(context.store, context.payload);
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'admin.settings.update',
      targetType: 'app_settings',
      targetId: 'main',
      metadata: values as Row,
    });
    return values;
  },
};

const store = createStore();

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: authUser, error: authError } = await anon.auth.getUser(token);
  if (authError || !authUser.user || authUser.user.app_metadata?.role !== 'admin') {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const publicUser = await store.selectOne('users', { eq: { auth_user_id: authUser.user.id } });
  if (!publicUser) {
    return Response.json({ ok: false, error: 'admin user not found' }, { status: 403 });
  }
  let body: Row;
  try {
    body = (await request.json()) as Row;
  } catch {
    return Response.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }
  const handler = handlers[String(body.action ?? '')];
  if (!handler) {
    return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  try {
    const data = await handler({ store, actorId: String(publicUser.id), payload: (body.payload ?? {}) as Row });
    return Response.json({ ok: true, data });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
});
