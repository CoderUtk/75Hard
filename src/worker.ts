import api from './api/router';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return api.fetch(req, env, ctx);
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledController, _env: Env): Promise<void> {
    // wired up in Task 12
  },
} satisfies ExportedHandler<Env>;
