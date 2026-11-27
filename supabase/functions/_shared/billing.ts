import { sendTelegramMessageSafely } from './alerts.ts';
import { logAction } from './audit.ts';
import { config } from './env.ts';
import { createPixPayment, createPreference } from './mercadopago.ts';
import type { Row, Store } from './types.ts';
import { creditWallet } from './wallet.ts';

export function mapPaymentStatus(status: string): string {
  if (status === 'approved') {
    return 'paid';
  }
  if (['pending', 'in_process'].includes(status)) {
    return 'pending';
  }
  return 'failed';
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export async function activateManualSubscription(
  store: Store,
  input: { userId: string; planId: string | null; days: number; actorUserId?: string | null; note?: string | null },
): Promise<Row> {
  if (!input.days || input.days <= 0) {
    throw new Error('days deve ser maior que zero');
  }
  const now = new Date().toISOString();
  const subscription = await store.insert('subscriptions', {
    user_id: input.userId,
    plan_id: input.planId,
    source: 'manual',
    status: 'active',
    starts_at: now,
    ends_at: addDays(new Date(now), input.days).toISOString(),
    external_ref: null,
    created_at: now,
  });
  await store.update('users', input.userId, { status: 'active' });
  await store.insert('payments', {
    user_id: input.userId,
    subscription_id: subscription.id,
    provider: 'manual',
    amount_cents: 0,
    status: 'manual',
    external_id: `manual-${subscription.id}`,
    payload_json: { note: input.note ?? null, actor_user_id: input.actorUserId ?? null },
    created_at: now,
  });
  return subscription;
}

export async function createCheckout(store: Store, input: { userId: string; planId: string }): Promise<Row> {
  const plan = await store.selectById('plans', input.planId);
  if (!plan || plan.active === false) {
    throw new Error('Plano não encontrado ou inativo');
  }
  const amountCents = Number.parseInt(String(plan.price_cents ?? 0), 10);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Plano sem preço configurado');
  }
  const externalReference = `mp-${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  await store.insert('payments', {
    user_id: input.userId,
    plan_id: plan.id,
    provider: 'mercadopago',
    amount_cents: amountCents,
    status: 'pending',
    external_id: externalReference,
    external_reference: externalReference,
    created_at: now,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  try {
    const preference = await createPreference({
      externalReference,
      title: `Plano ${plan.name || plan.id}`,
      amountCents,
    });
    const checkoutUrl = preference.init_point || preference.sandbox_init_point;
    if (!checkoutUrl) {
      throw new Error('Mercado Pago não retornou init_point');
    }
    await store.update('payments', externalReference, {
      preference_id: preference.id ?? null,
      checkout_url: checkoutUrl,
      updated_at: new Date().toISOString(),
    }, 'external_reference');
    return { external_reference: externalReference, checkout_url: checkoutUrl, amount_cents: amountCents };
  } catch (error) {
    await store.update('payments', externalReference, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      updated_at: new Date().toISOString(),
    }, 'external_reference');
    throw new Error('Não foi possível gerar o link de pagamento');
  }
}

export async function createPixTopup(
  store: Store,
  input: { userId: string; planId: string; chatId?: string | number | null; email?: string | null },
): Promise<Row> {
  const plan = await store.selectById('plans', input.planId);
  if (!plan || plan.active === false || String(plan.kind ?? 'package') === 'legacy') {
    throw new Error('Pacote não encontrado ou inativo');
  }
  const amountCents = Number.parseInt(String(plan.price_cents ?? 0), 10);
  const creditCents = Number.parseInt(String(plan.credit_cents ?? plan.price_cents ?? 0), 10);
  if (!Number.isFinite(amountCents) || amountCents <= 0 || !Number.isFinite(creditCents) || creditCents <= 0) {
    throw new Error('Pacote sem valor configurado');
  }
  const externalReference = `pix-${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  await store.insert('payments', {
    user_id: input.userId,
    plan_id: plan.id,
    provider: 'mercadopago',
    kind: 'pix',
    amount_cents: amountCents,
    credit_cents: creditCents,
    status: 'pending',
    external_id: externalReference,
    external_reference: externalReference,
    telegram_chat_id: input.chatId ?? null,
    created_at: now,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  try {
    const payment = await createPixPayment({
      externalReference,
      title: `Créditos ${plan.name || 'Básico'}`,
      amountCents,
      email: input.email,
      chatId: input.chatId,
    });
    const transactionData = payment?.point_of_interaction?.transaction_data ?? {};
    await store.update('payments', externalReference, {
      mercadopago_payment_id: payment.id ? String(payment.id) : null,
      qr_code: transactionData.qr_code ?? null,
      qr_code_base64: transactionData.qr_code_base64 ?? null,
      checkout_url: transactionData.ticket_url ?? null,
      status: mapPaymentStatus(String(payment.status ?? 'pending')),
      updated_at: new Date().toISOString(),
    }, 'external_reference');
    return {
      external_reference: externalReference,
      payment_id: payment.id ? String(payment.id) : null,
      amount_cents: amountCents,
      credit_cents: creditCents,
      qr_code: transactionData.qr_code ?? null,
      qr_code_base64: transactionData.qr_code_base64 ?? null,
      checkout_url: transactionData.ticket_url ?? null,
    };
  } catch (error) {
    await store.update('payments', externalReference, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      updated_at: new Date().toISOString(),
    }, 'external_reference');
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function activateSubscription(
  store: Store,
  input: { externalReference: string; userId: string; planId: string | null },
): Promise<void> {
  const existing = await store.selectOne('subscriptions', { eq: { external_ref: input.externalReference } });
  if (existing) {
    return;
  }
  const plan = input.planId ? await store.selectById('plans', input.planId) : null;
  const days = Number.parseInt(String(plan?.period_days ?? 30), 10) || 30;
  const now = new Date().toISOString();
  await store.update('users', input.userId, { status: 'active' });
  await store.insert('subscriptions', {
    user_id: input.userId,
    plan_id: input.planId,
    source: 'mercadopago',
    status: 'active',
    starts_at: now,
    ends_at: addDays(new Date(now), days).toISOString(),
    external_ref: input.externalReference,
    payment_id: input.externalReference,
    created_at: now,
  });
}

export async function processMercadoPagoPayment(store: Store, payment: Row): Promise<Row> {
  const paymentId = String(payment?.id ?? '');
  const externalReference = String(payment?.external_reference ?? '');
  const checkout = externalReference
    ? await store.selectOne('payments', { eq: { external_reference: externalReference } })
    : null;
  const mappedStatus = mapPaymentStatus(String(payment?.status ?? 'pending'));
  const plan = checkout?.plan_id ? await store.selectById('plans', String(checkout.plan_id)) : null;
  const isPixCredit = String(checkout?.kind ?? '') === 'pix'
    || Number.parseInt(String(checkout?.credit_cents ?? 0), 10) > 0
    || String(plan?.kind ?? '') === 'package';
  const existing = paymentId
    ? await store.selectOne('payments', { eq: { mercadopago_payment_id: paymentId } })
    : null;
  const payload: Row = {
    provider: 'mercadopago',
    mercadopago_payment_id: paymentId,
    external_id: externalReference || paymentId || `mp-${crypto.randomUUID()}`,
    external_reference: externalReference || null,
    amount_cents: Math.round(Number(payment?.transaction_amount ?? 0) * 100),
    status: mappedStatus,
    payload_json: payment,
    updated_at: new Date().toISOString(),
    error: null,
  };
  if (checkout) {
    payload.user_id = checkout.user_id;
    payload.plan_id = checkout.plan_id;
  }
  const alreadyProcessed = Boolean(existing && existing.mercadopago_payment_id === paymentId && existing.status === mappedStatus);
  const saved = existing
    ? (await store.update('payments', existing.id, payload)) ?? existing
    : await store.insert('payments', { ...payload, created_at: new Date().toISOString() });

  if (checkout?.user_id) {
    if (mappedStatus === 'paid' && isPixCredit) {
      const creditCents = Number.parseInt(String(checkout.credit_cents ?? plan?.credit_cents ?? 0), 10)
        || Math.round(Number(payment?.transaction_amount ?? 0) * 100);
      const balance = await creditWallet(store, {
        userId: String(checkout.user_id),
        amountCents: creditCents,
        reference: `payment:${paymentId || externalReference}`,
        description: `Créditos ${plan?.name ?? 'PIX'}`,
        metadata: { payment_id: paymentId, external_reference: externalReference },
      }, 'credit');
      await store.update('users', String(checkout.user_id), { status: 'active' });
      if (checkout.telegram_chat_id) {
        const reais = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
        await sendTelegramMessageSafely(String(checkout.telegram_chat_id), `PIX confirmado! ${reais(creditCents)} creditados. Saldo atual: ${reais(balance)}.`);
      }
      await logAction(store, {
        actorUserId: checkout.user_id,
        action: 'payment.wallet.credited',
        targetType: 'payment',
        targetId: String(saved.id),
        metadata: { credit_cents: creditCents, balance_cents: balance },
      });
    } else if (mappedStatus === 'paid' && !alreadyProcessed) {
      await activateSubscription(store, {
        externalReference,
        userId: String(checkout.user_id),
        planId: checkout.plan_id ?? null,
      });
    } else if (mappedStatus === 'failed' && externalReference) {
      const subscription = await store.selectOne('subscriptions', { eq: { external_ref: externalReference } });
      if (subscription) {
        await store.update('subscriptions', subscription.id, { status: 'canceled' });
      }
    }
  }

  await logAction(store, {
    actorUserId: checkout?.user_id ?? null,
    action: 'payment.mercadopago.processed',
    targetType: 'payment',
    targetId: String(saved.id),
    metadata: { status: mappedStatus, payment_id: paymentId, external_reference: externalReference },
  });
  return saved;
}

export async function expireSubscriptions(store: Store): Promise<number> {
  const now = Date.now();
  const subscriptions = await store.select('subscriptions', {
    eq: { status: 'active' },
    order: { column: 'ends_at', ascending: true },
    limit: 5000,
  });
  let count = 0;
  for (const subscription of subscriptions) {
    const endsAt = subscription.ends_at ? new Date(subscription.ends_at).getTime() : Number.NaN;
    if (Number.isFinite(endsAt) && endsAt < now) {
      await store.update('subscriptions', subscription.id, { status: 'expired' });
      count += 1;
    }
  }
  return count;
}

export async function bootstrap(store: Store): Promise<void> {
  const adminEmail = envAdminEmail();
  if (adminEmail) {
    const admin = await store.selectOne('users', { eq: { email: adminEmail } });
    if (admin) {
      await store.update('users', admin.id, { role: 'admin', status: 'active' });
    }
  }
  const packages = [
    { name: 'Básico', price_cents: 1500, credit_cents: 1500 },
    { name: 'Operacional', price_cents: 3000, credit_cents: 3500 },
    { name: 'Profissional', price_cents: 5000, credit_cents: 6500 },
  ];
  for (const item of packages) {
    const existing = await store.select('plans', { eq: { name: item.name }, limit: 1 });
    if (existing.length === 0) {
      await store.insert('plans', {
        ...item,
        period_days: 0,
        active: true,
        kind: 'package',
        queries_per_day: null,
        created_at: new Date().toISOString(),
      });
    }
  }
}

function envAdminEmail(): string {
  const host = globalThis as typeof globalThis & { Deno?: { env: { get(key: string): string | undefined } }; process?: { env?: Record<string, string | undefined> } };
  return host.Deno?.env?.get('ADMIN_EMAIL') ?? host.process?.env?.['ADMIN_EMAIL'] ?? '';
}

export function configuredBaseUrl(): string {
  return config.baseUrl;
}
