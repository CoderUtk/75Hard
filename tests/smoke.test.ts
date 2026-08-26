// tests/smoke.test.ts
import { env, SELF } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('serves the api health route', async () => {
  const res = await SELF.fetch('https://example.com/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

it('binds D1', () => {
  expect(env.DB).toBeDefined();
});
