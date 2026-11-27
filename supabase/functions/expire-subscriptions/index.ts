import { cronAuthorized } from '../_shared/cron.ts';
import { expireSubscriptions } from '../_shared/billing.ts';
import { createStore } from '../_shared/store.ts';

const store = createStore();

Deno.serve(async (request: Request) => {
  if (!cronAuthorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const expired = await expireSubscriptions(store);
    await store.insert('job_runs', { job_name: 'expire-subscriptions', status: 'success', detail: { expired } });
    return Response.json({ ok: true, expired });
  } catch (error) {
    await store.insert('job_runs', {
      job_name: 'expire-subscriptions',
      status: 'failed',
      detail: { error: error instanceof Error ? error.message : String(error) },
    });
    return Response.json({ ok: false, error: 'job failed' }, { status: 500 });
  }
});
