import { timingSafeEqual } from './crypto.ts';
import { env } from './env.ts';

export function cronAuthorized(request: Request): boolean {
  const secret = env('CRON_SECRET');
  if (!secret) {
    return false;
  }
  const provided = request.headers.get('apikey') ?? request.headers.get('x-cron-secret') ?? '';
  return timingSafeEqual(secret, provided);
}
