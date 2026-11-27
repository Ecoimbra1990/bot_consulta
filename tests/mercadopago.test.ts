import { describe, expect, it } from 'vitest';
import { hmacHex } from '../supabase/functions/_shared/crypto.ts';
import { verifyWebhookSignature } from '../supabase/functions/_shared/mercadopago.ts';

describe('webhook Mercado Pago', () => {
  it('valida assinatura x-signature', async () => {
    const secret = 'webhook-secret';
    const ts = '1700000000';
    const requestId = 'request-1';
    const dataId = '123456';
    const v1 = await hmacHex(secret, `id:${dataId};request-id:${requestId};ts:${ts};`);
    expect(await verifyWebhookSignature(`ts=${ts},v1=${v1}`, requestId, dataId, secret)).toBe(true);
    expect(await verifyWebhookSignature(`ts=${ts},v1=invalido`, requestId, dataId, secret)).toBe(false);
    expect(await verifyWebhookSignature(null, requestId, dataId, secret)).toBe(false);
  });
});
