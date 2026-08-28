import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { listActiveGoals } from '../src/db/goals';
import { getActiveRun } from '../src/db/runs';
import { todayIST } from '../src/lib/dates';

// Start runs on the server's "today". A hardcoded past date time-bombs the
// suite: the next authed request's catchUpGrading fails the run for the
// missed days, so the active-run guards under test never fire.
const START = todayIST(new Date());

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
  const res = await post('/api/onboarding', { variant: 'hard', startDate: START });
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
  await post('/api/onboarding', { variant: 'soft', startDate: START });
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(4);
});

it('refuses a second onboarding while a run is active', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: START });
  const res = await post('/api/onboarding', { variant: 'soft', startDate: START });
  expect(res.status).toBe(409);
});

it('refuses reset while the run is still active', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: START });
  const res = await post('/api/run/reset', {});
  expect(res.status).toBe(409);
});

it('starts attempt 2 after a failure, keeping goals and archiving the old run', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: START });
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
  await post('/api/onboarding', { variant: 'hard', startDate: START });
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
    post('/api/onboarding', { variant: 'hard', startDate: START }),
    post('/api/onboarding', { variant: 'hard', startDate: START }),
  ]);
  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual([200, 409]);

  const { results } = await env.DB.prepare('SELECT * FROM runs WHERE user_id = ?')
    .bind('u1').all();
  expect(results).toHaveLength(1);

  // The loser must not leave orphaned seeded goals behind.
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(6);
});

it('a failed seeding batch leaves no stuck active run behind', async () => {
  // Force the 'Alcohol' banned-food insert (part of the hard preset) to
  // collide with an existing row, so the run+goals+foods batch fails.
  await env.DB.prepare(
    "INSERT INTO food_items (id,user_id,name,status) VALUES (?,?,?,'banned')",
  ).bind('blocker', 'u1', 'Alcohol').run();

  const failed = await post('/api/onboarding', { variant: 'hard', startDate: START });
  expect(failed.status).not.toBe(200);

  // No half-seeded, permanently-active run left locking the user out.
  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(0);

  // Clear the blocker and retry: must succeed normally, not 409.
  await env.DB.prepare('DELETE FROM food_items WHERE id = ?').bind('blocker').run();
  const retried = await post('/api/onboarding', { variant: 'hard', startDate: START });
  expect(retried.status).toBe(200);
  expect(await getActiveRun(env.DB, 'u1')).not.toBeNull();
});
