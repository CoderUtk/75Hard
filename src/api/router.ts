import { Hono } from 'hono';
import { auth } from './auth';
import { me } from './me';
import { requireAuth, type App } from './middleware';

export const api = new Hono<App>().basePath('/api');

api.get('/health', (c) => c.json({ ok: true }));
api.route('/auth', auth);

api.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/health') return next();
  return requireAuth(c, next);
});

api.route('/me', me);          // GET /api/me
api.route('/', me);            // POST /api/onboarding, POST /api/run/reset

export default api;
