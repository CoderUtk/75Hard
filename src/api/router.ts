import { Hono } from 'hono';
import { auth } from './auth';
import { me } from './me';
import { goals } from './goals';
import { days } from './days';
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
api.route('/goals', goals);    // GET/POST /api/goals, PATCH/DELETE /api/goals/:id
api.route('/days', days);      // GET /api/days/:date, PUT /api/days/:date/goals/:goalId

export default api;
