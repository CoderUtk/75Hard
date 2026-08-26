import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { runDailyLock } from '../src/services/cron';
import { createRun, getActiveRun } from '../src/db/runs';
import { createGoal } from '../src/db/goals';
import { countStrikes } from '../src/db/strikes';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM users'),
  ]);
  for (const [id, name] of [['u1', 'A'], ['u2', 'B']] as const) {
    await env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, name, '#EA580C', 'h', 's', 1).run();
  }
});

it('grades every user with an active run, not just one', async () => {
  for (const uid of ['u1', 'u2']) {
    await createGoal(env.DB, uid, { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
    await createRun(env.DB, uid, 'soft', '2026-08-26', 1);
  }

  // 12:30 IST on the 27th — the 26th is now gradable and nobody logged anything.
  const res = await runDailyLock(env.DB, new Date('2026-08-27T07:00:00Z'));
  expect(res.graded).toBe(2);

  for (const uid of ['u1', 'u2']) {
    const run = await env.DB.prepare('SELECT id FROM runs WHERE user_id = ?')
      .bind(uid).first<{ id: string }>();
    expect(await countStrikes(env.DB, run!.id)).toBe(1);
  }
});

it('is a no-op when nobody has an active run', async () => {
  const res = await runDailyLock(env.DB, new Date('2026-08-27T07:00:00Z'));
  expect(res.graded).toBe(0);
});

it('continues grading remaining users when one user has corrupt data', async () => {
  // User u1 with valid data
  await createGoal(env.DB, 'u1', { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  await createRun(env.DB, 'u1', 'soft', '2026-08-26', 1);

  // User u2 with corrupt goals_snapshot
  await createGoal(env.DB, 'u2', { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  const runRes = await env.DB.prepare(
    'INSERT INTO runs (id, user_id, variant, attempt_no, start_date, status, ended_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind('r2', 'u2', 'soft', 1, '2026-08-26', 'active', null).run();

  // Corrupt u2's days by inserting a day with invalid JSON
  await env.DB.prepare(
    'INSERT INTO days (id, run_id, date, day_number, state, goals_snapshot, locked_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind('d2', 'r2', '2026-08-26', 1, 'open', 'not json', null).run();

  // Run the cron - should grade u1 successfully even though u2 fails
  const res = await runDailyLock(env.DB, new Date('2026-08-27T07:00:00Z'));

  // One user graded successfully, one failed but didn't crash the whole thing
  expect(res.graded).toBe(1);

  // u1 should have received a strike (no progress logged)
  const run1 = await env.DB.prepare('SELECT id FROM runs WHERE user_id = ?')
    .bind('u1').first<{ id: string }>();
  expect(await countStrikes(env.DB, run1!.id)).toBe(1);
});
