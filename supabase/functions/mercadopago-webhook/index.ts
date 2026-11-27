import { config } from '../_shared/env.ts';
import { processMercadoPagoPayment } from '../_shared/billing.ts';
import { fetchPayment, verifyWebhookSignature } from '../_shared/mercadopago.ts';
import { createStore } from '../_shared/store.ts';

const store = createStore();

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }
  let payload: Record<string, any> = {};
  try {
    payload = (await request.json()) as Record<string, any>;
  } catch {
    return Response.json({ ok: true, ignored: true });
  }
  const dataId = String(payload?.data?.id ?? payload?.id ?? '');
  if (!dataId) {
    return Response.json({ ok: true, ignored: true });
  }
  const signature = request.headers.get('x-signature');
  const requestId = request.headers.get('x-request-id');
  if (!(await verifyWebhookSignature(signature, requestId, dataId))) {
    return Response.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }
  const topic = payload.type ?? payload.topic;
  if (topic && !String(topic).includes('payment')) {
    return Response.json({ ok: true, ignored: topic });
  }
  if (!config.mercadoPago.accessToken) {
    return Response.json({ ok: false, error: 'MERCADOPAGO_ACCESS_TOKEN não configurado' }, { status: 503 });
  }
  try {
    const payment = await fetchPayment(dataId);
    await processMercadoPagoPayment(store, payment);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
});
