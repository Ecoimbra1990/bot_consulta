import { cronAuthorized } from '../_shared/cron.ts';
import { purgeExpiredRaw } from '../_shared/dsr.ts';
import { createStore } from '../_shared/store.ts';

const store = createStore();

Deno.serve(async (request: Request) => {
  if (!cronAuthorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const purged = await purgeExpiredRaw(store);
    await store.insert('job_runs', { job_name: 'retention-purge', status: 'success', detail: { purged } });
    return Response.json({ ok: true, purged });
  } catch (error) {
    await store.insert('job_runs', {
      job_name: 'retention-purge',
      status: 'failed',
      detail: { error: error instanceof Error ? error.message : String(error) },
    });
    return Response.json({ ok: false, error: 'job failed' }, { status: 500 });
  }
});
