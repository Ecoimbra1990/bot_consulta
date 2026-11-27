import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCheckout, createPixTopup, expireSubscriptions, mapPaymentStatus, processMercadoPagoPayment } from '../supabase/functions/_shared/billing.ts';
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

  it('cria checkout legado e ativa assinatura de forma idempotente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'pref_1', init_point: 'https://checkout.local/pay' }), { status: 200 })));
    const store = new MemoryStore();
    await store.insert('users', { id: 'u1', status: 'pending', wallet_balance_cents: 0 });
    const plan = await store.insert('plans', { id: 'p1', name: 'Mensal', price_cents: 4990, period_days: 30, active: true, kind: 'legacy' });

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

  it('gera PIX e credita saldo uma única vez', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/payments') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          id: 123456,
          status: 'pending',
          point_of_interaction: {
            transaction_data: {
              qr_code: '00020126580014BR.GOV.BCB.PIX',
              qr_code_base64: 'YmFzZTY0',
              ticket_url: 'https://pix.local/pay',
            },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'pref_1', init_point: 'https://checkout.local/pay' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryStore();
    await store.insert('users', { id: 'u1', status: 'pending', wallet_balance_cents: 0 });
    const plan = await store.insert('plans', {
      id: 'pkg1',
      name: 'Operacional',
      price_cents: 3000,
      credit_cents: 3500,
      period_days: 0,
      active: true,
      kind: 'package',
    });

    const pix = await createPixTopup(store, {
      userId: 'u1',
      planId: String(plan.id),
      chatId: 555,
      email: 'cliente@example.com',
    });
    expect(pix.qr_code).toContain('PIX');
    expect(pix.credit_cents).toBe(3500);

    const payment = {
      id: 123456,
      status: 'approved',
      external_reference: pix.external_reference,
      transaction_amount: 30,
    };
    await processMercadoPagoPayment(store, payment);
    await processMercadoPagoPayment(store, payment);

    const user = await store.selectById('users', 'u1');
    expect(user?.wallet_balance_cents).toBe(3500);
    expect(await store.select('wallet_transactions', { eq: { user_id: 'u1' } })).toHaveLength(1);
  });

  it('expira assinaturas vencidas', async () => {
    const store = new MemoryStore();
    await store.insert('subscriptions', { status: 'active', ends_at: new Date(Date.now() - 86_400_000).toISOString() });
    await store.insert('subscriptions', { status: 'active', ends_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await expireSubscriptions(store)).toBe(1);
  });
});
