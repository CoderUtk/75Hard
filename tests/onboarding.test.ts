import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { listActiveGoals } from '../src/db/goals';
import { getActiveRun } from '../src/db/runs';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM food_items'),
    env.DB.prepare('DELETE FROM goals'), env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u1', 'Utkarsh', '#EA580C', hash, salt, Date.now()).run();

  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

const post = (path: string, body: unknown) =>
  SELF.fetch(`https://example.com${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

it('seeds hard preset goals and banned foods, and creates attempt 1', async () => {
  const res = await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  expect(res.status).toBe(200);

  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(6);
  const run = await getActiveRun(env.DB, 'u1');
  expect(run?.variant).toBe('hard');
  expect(run?.attempt_no).toBe(1);

  const banned = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM food_items WHERE user_id='u1' AND status='banned'",
  ).first<{ n: number }>();
  expect(banned?.n).toBe(5);
});

it('seeds fewer goals for soft', async () => {
  await post('/api/onboarding', { variant: 'soft', startDate: '2026-08-26' });
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(4);
});

it('refuses a second onboarding while a run is active', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  const res = await post('/api/onboarding', { variant: 'soft', startDate: '2026-08-26' });
  expect(res.status).toBe(409);
});

it('refuses reset while the run is still active', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  const res = await post('/api/run/reset', {});
  expect(res.status).toBe(409);
});

it('starts attempt 2 after a failure, keeping goals and archiving the old run', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  const first = await getActiveRun(env.DB, 'u1');
  await env.DB.prepare("UPDATE runs SET status='failed', ended_date='2026-08-30' WHERE id=?")
    .bind(first!.id).run();

  const res = await post('/api/run/reset', {});
  expect(res.status).toBe(200);

  const second = await getActiveRun(env.DB, 'u1');
  expect(second?.attempt_no).toBe(2);
  expect(second?.id).not.toBe(first!.id);
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(6); // carried over, not reseeded

  const old = await env.DB.prepare('SELECT status FROM runs WHERE id = ?')
    .bind(first!.id).first<{ status: string }>();
  expect(old?.status).toBe('failed'); // archived, not deleted
});

it('starts attempt 2 after a completed (done) run, not just a failed one', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  const first = await getActiveRun(env.DB, 'u1');
  await env.DB.prepare("UPDATE runs SET status='done', ended_date='2026-11-08' WHERE id=?")
    .bind(first!.id).run();

  const res = await post('/api/run/reset', {});
  expect(res.status).toBe(200);

  const second = await getActiveRun(env.DB, 'u1');
  expect(second?.attempt_no).toBe(2);
  expect(second?.id).not.toBe(first!.id);

  const old = await env.DB.prepare('SELECT status FROM runs WHERE id = ?')
    .bind(first!.id).first<{ status: string }>();
  expect(old?.status).toBe('done'); // archived, not deleted
});

it('one of two concurrent onboarding requests wins with a 409, not a 500', async () => {
  const [a, b] = await Promise.all([
    post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' }),
    post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' }),
  ]);
  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual([200, 409]);

  const { results } = await env.DB.prepare('SELECT * FROM runs WHERE user_id = ?')
    .bind('u1').all();
  expect(results).toHaveLength(1);

  // The loser must not leave orphaned seeded goals behind.
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(6);
});
