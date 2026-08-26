import { Hono } from 'hono';
import { auth } from './auth';
import { requireAuth, type App } from './middleware';

export const api = new Hono<App>().basePath('/api');

api.get('/health', (c) => c.json({ ok: true }));
api.route('/auth', auth);

api.use('/me/*', requireAuth);
api.use('/me', requireAuth);

// Placeholder so the auth test can assert a 200 behind the guard.
// Replaced with the real handler in Task 9.
api.get('/me', (c) => c.json({ user: c.get('user') }));

export default api;
