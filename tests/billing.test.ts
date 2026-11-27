import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCheckout, expireSubscriptions, mapPaymentStatus, processMercadoPagoPayment } from '../supabase/functions/_shared/billing.ts';
import { MemoryStore } from './helpers/memory-store.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('billing', () => {
  it('mapeia status do Mercado Pago', () => {
    expect(mapPaymentStatus('approved')).toBe('paid');
    expect(mapPaymentStatus('pending')).toBe('pending');
    expect(mapPaymentStatus('rejected')).toBe('failed');
  });

  it('cria checkout e ativa assinatura de forma idempotente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'pref_1', init_point: 'https://checkout.local/pay' }), { status: 200 })));
    const store = new MemoryStore();
    await store.insert('users', { id: 'u1', status: 'pending' });
    const plan = await store.insert('plans', { id: 'p1', name: 'Mensal', price_cents: 4990, period_days: 30, active: true });

    const checkout = await createCheckout(store, { userId: 'u1', planId: String(plan.id) });
    expect(checkout.checkout_url).toBe('https://checkout.local/pay');
    expect(checkout.amount_cents).toBe(4990);

    const payment = {
      id: 987654321,
      status: 'approved',
      external_reference: checkout.external_reference,
      transaction_amount: 49.9,
    };
    await processMercadoPagoPayment(store, payment);
    await processMercadoPagoPayment(store, payment);

    expect(await store.select('subscriptions', { eq: { external_ref: checkout.external_reference } })).toHaveLength(1);
    const user = await store.selectById('users', 'u1');
    expect(user?.status).toBe('active');
  });

  it('expira assinaturas vencidas', async () => {
    const store = new MemoryStore();
    await store.insert('subscriptions', { status: 'active', ends_at: new Date(Date.now() - 86_400_000).toISOString() });
    await store.insert('subscriptions', { status: 'active', ends_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await expireSubscriptions(store)).toBe(1);
  });
});
