import { notifyAdminSafely } from '../_shared/alerts.ts';
import { syncApiCatalog } from '../_shared/catalog.ts';
import { createStore } from '../_shared/store.ts';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }
  try {
    const store = createStore();
    const result = await syncApiCatalog(store);
    if (result.alerts.length > 0) {
      await notifyAdminSafely(`Alerta do catálogo APIBrasil:\n${result.alerts.join('\n')}`);
    }
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await notifyAdminSafely(`Falha ao sincronizar catálogo da APIBrasil: ${message}`);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
});
