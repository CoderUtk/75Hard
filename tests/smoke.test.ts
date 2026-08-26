import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.MIGRATIONS);
});

it('serves the api health route', async () => {
  const res = await SELF.fetch('https://example.com/api/health');
  expect(res.status).toBe(200);
});

it('creates every table', async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all<{ name: string }>();
  const names = results.map((r) => r.name);
  for (const t of [
    'users', 'sessions', 'runs', 'goals', 'days', 'progress',
    'food_items', 'food_log', 'strikes', 'photos', 'push_subs',
  ]) {
    expect(names).toContain(t);
  }
});

it('permits only one active run per user', async () => {
  await env.DB.prepare(
    "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u1','A','#EA580C','h','s',1)",
  ).run();
  const insertRun = (id: string, status: string) =>
    env.DB.prepare(
      'INSERT INTO runs (id,user_id,variant,attempt_no,start_date,status) VALUES (?,?,?,?,?,?)',
    ).bind(id, 'u1', 'hard', 1, '2026-08-26', status).run();

  await insertRun('r1', 'active');
  await expect(insertRun('r2', 'active')).rejects.toThrow();
  // a failed run alongside an active one is fine
  await expect(insertRun('r3', 'failed')).resolves.toBeDefined();
});
