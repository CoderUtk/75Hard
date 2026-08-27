import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

it('has a photos table and an R2 bucket bound', async () => {
  const row = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='photos'",
  ).first<{ name: string }>();
  expect(row?.name).toBe('photos');

  await env.PHOTOS.put('probe', 'hello');
  const obj = await env.PHOTOS.get('probe');
  expect(await obj?.text()).toBe('hello');
});
