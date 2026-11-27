import { config } from './env.ts';
import { hmacHex, timingSafeEqual } from './crypto.ts';
import type { Row } from './types.ts';

export async function verifyWebhookSignature(
  signatureHeader: string | null | undefined,
  requestId: string | null | undefined,
  dataId: string,
  secret: string | null = config.mercadoPago.webhookSecret,
): Promise<boolean> {
  if (!secret || !signatureHeader) {
    return false;
  }
  const parts: Row = {};
  for (const chunk of signatureHeader.split(',')) {
    const separator = chunk.indexOf('=');
    if (separator >= 0) {
      parts[chunk.slice(0, separator).trim()] = chunk.slice(separator + 1).trim();
    }
  }
  const ts = parts.ts;
  const version = parts.v1;
  if (!ts || !version) {
    return false;
  }
  const manifest = `id:${dataId};request-id:${requestId ?? ''};ts:${ts};`;
  const expected = await hmacHex(secret, manifest);
  return timingSafeEqual(expected, String(version));
}

export async function fetchPayment(paymentId: string): Promise<Row> {
  const response = await fetch(`${config.mercadoPago.apiBase}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${config.mercadoPago.accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Mercado Pago HTTP ${response.status}`);
  }
  return (await response.json()) as Row;
}

function notificationUrl(): string {
  if (config.mercadoPago.notificationUrl) {
    return config.mercadoPago.notificationUrl;
  }
  if (config.supabaseUrl) {
    return `${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/mercadopago-webhook`;
  }
  if (config.baseUrl) {
    return `${config.baseUrl.replace(/\/$/, '')}/webhooks/mercadopago`;
  }
  return '';
}

export async function createPixPayment(input: {
  externalReference: string;
  title: string;
  amountCents: number;
  email?: string | null;
  chatId?: string | number | null;
}): Promise<Row> {
  const email = input.email || config.mercadoPago.payerEmail;
  if (!email) {
    throw new Error('MERCADOPAGO_PAYER_EMAIL não configurado');
  }
  const body: Row = {
    transaction_amount: Math.round(input.amountCents) / 100,
    description: input.title,
    external_reference: input.externalReference,
    payment_method_id: 'pix',
    payer: { email },
    metadata: input.chatId ? { telegram_chat_id: String(input.chatId) } : {},
  };
  const url = notificationUrl();
  if (url) {
    body.notification_url = url;
  }
  const response = await fetch(`${config.mercadoPago.apiBase}/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mercadoPago.accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': input.externalReference,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Mercado Pago HTTP ${response.status}`);
  }
  return (await response.json()) as Row;
}

export async function createPreference(input: { externalReference: string; title: string; amountCents: number }): Promise<Row> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const body: Row = {
    items: [
      {
        title: input.title,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: Math.round(input.amountCents) / 100,
      },
    ],
    external_reference: input.externalReference,
    binary_mode: true,
  };
  if (baseUrl.startsWith('http')) {
    body.notification_url = `${baseUrl}/webhooks/mercadopago`;
    body.back_urls = {
      success: `${baseUrl}/admin/`,
      pending: `${baseUrl}/admin/`,
      failure: `${baseUrl}/admin/`,
    };
  }
  const response = await fetch(`${config.mercadoPago.apiBase}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mercadoPago.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Mercado Pago HTTP ${response.status}`);
  }
  return (await response.json()) as Row;
}
