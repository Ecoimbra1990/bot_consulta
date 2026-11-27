import { createClient } from 'npm:@supabase/supabase-js@^2.58.0';
import { activateManualSubscription } from '../_shared/billing.ts';
import { logAction } from '../_shared/audit.ts';
import { syncApiCatalog } from '../_shared/catalog.ts';
import { resolveDeletion } from '../_shared/dsr.ts';
import { normalizeModuleInput } from '../_shared/modules.ts';
import { updateRuntimeSettings } from '../_shared/settings.ts';
import { createStore } from '../_shared/store.ts';
import { linkTelegramAccount } from '../_shared/telegram-users.ts';
import type { Row, Store } from '../_shared/types.ts';
import { creditWallet, debitWallet } from '../_shared/wallet.ts';

interface AdminContext {
  store: Store;
  actorId: string;
  payload: Row;
}

type Handler = (context: AdminContext) => Promise<Row>;

function corsHeaders(request: Request): Headers {
  const origin = request.headers.get('origin') ?? '';
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = new Set([
    'https://bot-consulta.ankecs.workers.dev',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...configured,
  ]);
  const headers = new Headers({ Vary: 'Origin' });
  if (allowed.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

function json(body: unknown, status: number, request: Request): Response {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

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
  const authUserId = created.data.user?.id;
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

interface CrudSpec {
  columns: string[];
  label: string;
}

const CRUD_SPECS: Record<string, CrudSpec> = {
  users: { columns: ['name', 'telegram_id', 'email', 'role', 'status', 'wallet_balance_cents'], label: 'user' },
  plans: { columns: ['name', 'price_cents', 'credit_cents', 'period_days', 'active', 'queries_per_day', 'kind'], label: 'plan' },
  subscriptions: { columns: ['user_id', 'plan_id', 'status', 'starts_at', 'ends_at', 'external_ref', 'payment_id'], label: 'subscription' },
  payments: { columns: ['user_id', 'plan_id', 'subscription_id', 'amount_cents', 'credit_cents', 'kind', 'telegram_chat_id', 'status', 'external_id', 'external_reference', 'checkout_url', 'error'], label: 'payment' },
  queries: { columns: ['entity', 'key_type', 'key_masked', 'status', 'cost_cents', 'charged_cents', 'module_key', 'error'], label: 'query' },
  api_modules: { columns: ['module_key', 'label', 'endpoint', 'cost_cents', 'balance_cents', 'source', 'entity', 'key_type', 'mode', 'dataset_key', 'service_name', 'active', 'managed_by', 'menu_order'], label: 'api_module' },
  user_telegram_accounts: { columns: ['telegram_id', 'user_id', 'username'], label: 'telegram_link' },
  dsr_requests: { columns: ['status'], label: 'dsr_request' },
};

const NUMERIC_COLUMNS = new Set(['telegram_id', 'telegram_chat_id', 'price_cents', 'credit_cents', 'period_days', 'queries_per_day', 'amount_cents', 'cost_cents', 'charged_cents', 'wallet_balance_cents', 'menu_order']);
const REQUIRED_NON_NULL = new Set(['price_cents', 'amount_cents', 'cost_cents']);
const TIMESTAMP_COLUMNS = new Set(['starts_at', 'ends_at']);
const ENUM_VALUES: Record<string, string[]> = {
  role: ['admin', 'user'],
  kind: ['package', 'legacy', 'pix', 'credit', 'bonus', 'manual'],
  entity: ['PF', 'EMPRESA', 'TELEFONE', 'VEICULO', 'VEICULO_FROTA'],
};

const STATUS_BY_TABLE: Record<string, string[]> = {
  users: ['active', 'blocked', 'pending'],
  subscriptions: ['active', 'past_due', 'canceled', 'expired'],
  payments: ['pending', 'paid', 'failed', 'manual'],
  queries: ['pending', 'completed', 'failed'],
  dsr_requests: ['pending', 'done', 'rejected'],
};

function normalizeCrudPatch(table: string, payload: Row): Row {
  const spec = CRUD_SPECS[table];
  if (!spec) {
    throw new Error(`Tabela não permitida: ${table}`);
  }
  const patch: Row = {};
  for (const column of spec.columns) {
    if (!(column in payload)) {
      continue;
    }
    let value = payload[column];
    if (NUMERIC_COLUMNS.has(column) && !(table === 'user_telegram_accounts' && column === 'telegram_id')) {
      if (value === '' || value === null || value === undefined) {
        if (REQUIRED_NON_NULL.has(column)) {
          throw new Error(`${column} é obrigatório`);
        }
        patch[column] = null;
        continue;
      }
      value = Number(value);
      if (!Number.isFinite(value)) {
        throw new Error(`${column} inválido`);
      }
      if ((column === 'price_cents' || column === 'telegram_id') && value <= 0) {
        throw new Error(`${column} inválido`);
      }
    } else if (column === 'active') {
      value = value === true || value === 'true' || value === 'on';
    } else if (typeof value === 'string') {
      value = value.trim();
    }
    if (TIMESTAMP_COLUMNS.has(column) && value !== null && value !== '') {
      const timestamp = Date.parse(String(value));
      if (!Number.isFinite(timestamp)) {
        throw new Error(`${column} inválido`);
      }
      value = new Date(timestamp).toISOString();
    }
    const allowed = column === 'status' ? STATUS_BY_TABLE[table] : ENUM_VALUES[column];
    if (allowed && value !== null && value !== '' && !allowed.includes(String(value))) {
      throw new Error(`${column} inválido`);
    }
    patch[column] = value;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('Nenhum campo para atualizar');
  }
  return patch;
}

async function updateUser(context: AdminContext, userId: string, patch: Row): Promise<Row> {
  const current = await context.store.selectById('users', userId);
  if (!current) {
    throw new Error('Usuário não encontrado');
  }
  if (userId === context.actorId && (patch.role === 'user' || (patch.status && patch.status !== 'active'))) {
    throw new Error('Você não pode alterar seu próprio perfil ou status');
  }
  const email = String(patch.email ?? current.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('E-mail inválido');
  }
  const role = ['admin', 'user'].includes(String(patch.role ?? current.role)) ? String(patch.role ?? current.role) : 'user';
  const statusValue = String(patch.status ?? current.status);
  const status = ['active', 'blocked', 'pending'].includes(statusValue) ? statusValue : 'pending';
  const name = String(patch.name ?? current.name ?? '').trim() || null;
  const telegramRaw = patch.telegram_id !== undefined ? patch.telegram_id : current.telegram_id;
  const telegramId = telegramRaw === null || telegramRaw === '' || telegramRaw === undefined ? null : Number(telegramRaw);
  if (telegramId !== null && (!Number.isSafeInteger(telegramId) || telegramId <= 0)) {
    throw new Error('Telegram ID inválido');
  }
  const authUserId = current.auth_user_id ? String(current.auth_user_id) : null;
  if (authUserId) {
    const admin = serviceClient();
    const { data: authData, error: authFetchError } = await admin.auth.admin.getUserById(authUserId);
    if (authFetchError && !/not found/i.test(authFetchError.message)) {
      throw new Error(authFetchError.message);
    }
    const appMetadata = { ...(authData?.user?.app_metadata ?? {}), role };
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(authUserId, {
      email,
      app_metadata: appMetadata,
    });
    if (authUpdateError) {
      throw new Error(authUpdateError.message);
    }
  }
  const updated = await context.store.update('users', userId, {
    name,
    email,
    telegram_id: telegramId,
    role,
    status,
  });
  if (!updated) {
    throw new Error('Usuário não encontrado');
  }
  await logAction(context.store, {
    actorUserId: context.actorId,
    action: 'user.update',
    targetType: 'user',
    targetId: userId,
    metadata: { role, status, email },
  });
  return updated;
}

async function deleteUser(context: AdminContext, userId: string): Promise<Row> {
  if (userId === context.actorId) {
    throw new Error('Você não pode excluir seu próprio usuário');
  }
  const target = await context.store.selectById('users', userId);
  if (!target) {
    throw new Error('Usuário não encontrado');
  }
  if (target.auth_user_id) {
    const { error } = await serviceClient().auth.admin.deleteUser(String(target.auth_user_id));
    if (error && !/not found/i.test(error.message)) {
      throw new Error(error.message);
    }
  }
  if (target.telegram_id) {
    await context.store.removeWhere('bot_sessions', 'telegram_id', target.telegram_id);
  }
  await context.store.remove('users', userId);
  await logAction(context.store, {
    actorUserId: context.actorId,
    action: 'user.delete',
    targetType: 'user',
    targetId: userId,
    metadata: { email: target.email },
  });
  return { id: userId, deleted: true };
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
  'crud.update': async (context) => {
    const table = String(context.payload.table ?? '');
    const id = String(context.payload.id ?? context.payload.user_id ?? '');
    if (!id) {
      throw new Error('ID obrigatório');
    }
    const payload = (context.payload.patch ?? {}) as Row;
    if (table === 'users') {
      return updateUser(context, id, normalizeCrudPatch('users', payload));
    }
    const spec = CRUD_SPECS[table];
    if (!spec) {
      throw new Error(`Tabela não permitida: ${table}`);
    }
    const patch = normalizeCrudPatch(table, payload);
    if (table === 'dsr_requests' && patch.status !== undefined) {
      const resolved = patch.status === 'done' || patch.status === 'rejected';
      patch.resolved_at = resolved ? new Date().toISOString() : null;
      patch.resolved_by = resolved ? context.actorId : null;
    }
    const updated = await context.store.update(table, id, patch);
    if (!updated) {
      throw new Error('Registro não encontrado');
    }
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: `admin.${spec.label}.update`,
      targetType: spec.label,
      targetId: id,
      metadata: patch as Row,
    });
    return updated;
  },
  'crud.delete': async (context) => {
    const table = String(context.payload.table ?? '');
    const id = String(context.payload.id ?? context.payload.user_id ?? '');
    if (!id) {
      throw new Error('ID obrigatório');
    }
    if (table === 'users') {
      return deleteUser(context, id);
    }
    const spec = CRUD_SPECS[table];
    if (!spec) {
      throw new Error(`Tabela não permitida: ${table}`);
    }
    await context.store.remove(table, id);
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: `admin.${spec.label}.delete`,
      targetType: spec.label,
      targetId: id,
      metadata: {},
    });
    return { id, deleted: true };
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
  'wallet.adjust': async (context) => {
    const userId = String(context.payload.user_id ?? context.payload.userId ?? '');
    const amountCents = Number.parseInt(String(context.payload.amount_cents ?? context.payload.amountCents ?? '0'), 10);
    const description = String(context.payload.description ?? 'Ajuste manual do administrador');
    if (!userId || !Number.isFinite(amountCents) || amountCents === 0) {
      throw new Error('Usuário e valor são obrigatórios');
    }
    const reference = `admin:${context.actorId}:${crypto.randomUUID()}`;
    const balance = amountCents > 0
      ? await creditWallet(context.store, { userId, amountCents, reference, description }, 'manual')
      : await debitWallet(context.store, { userId, amountCents: Math.abs(amountCents), reference, description });
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'wallet.manual.adjust',
      targetType: 'user',
      targetId: userId,
      metadata: { amount_cents: amountCents, balance_cents: balance },
    });
    return { user_id: userId, balance_cents: balance };
  },
  'telegram.link': async (context) => {
    const userId = String(context.payload.user_id ?? context.payload.userId ?? '');
    const telegramId = String(context.payload.telegram_id ?? context.payload.telegramId ?? '').trim();
    if (!userId || !telegramId || !/^\d+$/.test(telegramId)) {
      throw new Error('Usuário e Telegram ID são obrigatórios');
    }
    await linkTelegramAccount(context.store, telegramId, userId, context.payload.username ?? null);
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'telegram.link',
      targetType: 'user',
      targetId: userId,
      metadata: { telegram_id: telegramId },
    });
    return { user_id: userId, telegram_id: telegramId };
  },
  'plan.create': async (context) => {
    const name = String(context.payload.name ?? '').trim();
    const priceCents = Number.parseInt(String(context.payload.price_cents ?? context.payload.priceCents ?? '0'), 10);
    const creditCents = Number.parseInt(String(context.payload.credit_cents ?? context.payload.creditCents ?? String(priceCents)), 10);
    const periodDays = Number.parseInt(String(context.payload.period_days ?? context.payload.periodDays ?? '0'), 10);
    if (!name || !Number.isFinite(priceCents) || priceCents <= 0 || !Number.isFinite(creditCents) || creditCents <= 0) {
      throw new Error('Pacote inválido');
    }
    const plan = await context.store.insert('plans', {
      name,
      price_cents: priceCents,
      credit_cents: creditCents,
      period_days: Number.isFinite(periodDays) && periodDays > 0 ? periodDays : 0,
      active: context.payload.active !== false && context.payload.active !== 'false',
      kind: 'package',
      queries_per_day: null,
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
  'module.create': async (context) => {
    const row = normalizeModuleInput(context.payload);
    const created = await context.store.insert('api_modules', row);
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'admin.api_module.create',
      targetType: 'api_module',
      targetId: String(created.module_key),
      metadata: { entity: row.entity, key_type: row.key_type, mode: row.mode, source: row.source },
    });
    return created;
  },
  'module.update': async (context) => {
    const moduleKey = String(context.payload.module_key ?? context.payload.moduleKey ?? context.payload.id ?? '');
    const current = await context.store.selectById('api_modules', moduleKey, 'module_key');
    if (!current) {
      throw new Error('Módulo não encontrado');
    }
    const row = normalizeModuleInput({ ...current, ...context.payload, module_key: moduleKey });
    const updated = await context.store.update('api_modules', moduleKey, row, 'module_key');
    if (!updated) {
      throw new Error('Módulo não encontrado');
    }
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'admin.api_module.update',
      targetType: 'api_module',
      targetId: moduleKey,
      metadata: { entity: row.entity, key_type: row.key_type, mode: row.mode, source: row.source, active: row.active },
    });
    return updated;
  },
  'module.delete': async (context) => {
    const moduleKey = String(context.payload.module_key ?? context.payload.moduleKey ?? context.payload.id ?? '');
    if (!moduleKey) {
      throw new Error('Módulo obrigatório');
    }
    await context.store.remove('api_modules', moduleKey, 'module_key');
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'admin.api_module.delete',
      targetType: 'api_module',
      targetId: moduleKey,
      metadata: {},
    });
    return { module_key: moduleKey, deleted: true };
  },
  'catalog.sync': async (context) => {
    const result = await syncApiCatalog(context.store);
    await logAction(context.store, {
      actorUserId: context.actorId,
      action: 'admin.catalog.sync',
      targetType: 'api_catalog',
      targetId: 'main',
      metadata: { modules: result.modules, skipped: result.skipped },
    });
    return { ok: true, ...result };
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
  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(request);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Max-Age', '86400');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405, request);
  }
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) {
    return json({ ok: false, error: 'unauthorized' }, 401, request);
  }
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: authUser, error: authError } = await anon.auth.getUser(token);
  if (authError || !authUser.user || authUser.user.app_metadata?.role !== 'admin') {
    return json({ ok: false, error: 'forbidden' }, 403, request);
  }
  const publicUser = await store.selectOne('users', { eq: { auth_user_id: authUser.user.id } });
  if (!publicUser) {
    return json({ ok: false, error: 'admin user not found' }, 403, request);
  }
  let body: Row;
  try {
    body = (await request.json()) as Row;
  } catch {
    return json({ ok: false, error: 'invalid body' }, 400, request);
  }
  const handler = handlers[String(body.action ?? '')];
  if (!handler) {
    return json({ ok: false, error: 'unknown action' }, 400, request);
  }
  try {
    const data = await handler({ store, actorId: String(publicUser.id), payload: (body.payload ?? {}) as Row });
    return json({ ok: true, data }, 200, request);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400, request);
  }
});
