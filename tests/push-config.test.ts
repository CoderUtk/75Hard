import { Hono } from 'hono';
import { it, expect } from 'vitest';
import { push } from '../src/api/push';
import type { App } from '../src/api/middleware';

// vitest.config.ts sets VAPID bindings for the workers pool, so the integration
// tests in push-api.test.ts can never reach the 503 branch. Drive the router
// directly with a stub env that is missing the VAPID vars instead.
const stubEnv = { DB: {} } as unknown as App['Bindings'];

// Mount behind a middleware that satisfies the `c.get('user')` the handlers use.
const app = new Hono<App>();
app.use('*', async (c, next) => { c.set('user', { id: 'u1' } as any); await next(); });
app.route('/', push);

it('GET /vapid-public-key returns 503 without VAPID secrets', async () => {
  const res = await app.request('/vapid-public-key', {}, stubEnv);
  expect(res.status).toBe(503);
});

it('POST /subscribe returns 503 without VAPID secrets', async () => {
  const res = await app.request('/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }),
  }, stubEnv);
  expect(res.status).toBe(503);
});

it('DELETE /subscribe is not gated by VAPID config', async () => {
  const res = await app.request('/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'not-a-url' }),
  }, stubEnv);
  expect(res.status).not.toBe(503);
});
