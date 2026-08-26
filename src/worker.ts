export interface Env {
  DB: D1Database;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, _env: Env): Promise<void> {
    // wired up in Task 12
  },
} satisfies ExportedHandler<Env>;
