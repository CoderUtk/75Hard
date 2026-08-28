import api from './api/router';
import { runDailyLock } from './services/cron';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PHOTOS: R2Bucket;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return api.fetch(req, env, ctx);
    return env.ASSETS.fetch(req);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    // "30 6 * * *" is 12:00 IST — the daily lock.
    // "30 15 * * *" is 21:00 IST — the nudge push, added in Phase 5.
    if (event.cron === '30 6 * * *') {
      ctx.waitUntil(
        runDailyLock(env.DB, now)
          .then(({ graded }) => {
            console.log(`daily lock graded ${graded} users`);
          })
          .catch((err) => {
            console.error('daily lock failed', err);
          })
      );
    }
  },
} satisfies ExportedHandler<Env>;
