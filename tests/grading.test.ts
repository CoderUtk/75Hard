import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { catchUpGrading, lastGradableDate, ensureDay } from '../src/services/grading';
import { createRun, getActiveRun } from '../src/db/runs';
import { createGoal, listActiveGoals, toSnapshot } from '../src/db/goals';
import { listDays, setProgress, getDay } from '../src/db/days';
import { countStrikes, listStrikes } from '../src/db/strikes';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM users'),
  ]);
  await env.DB.prepare(
    "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u1','A','#EA580C','h','s',1)",
  ).run();
});

const afterNoon  = (d: string) => new Date(`${d}T07:00:00Z`); // 12:30 IST
const beforeNoon = (d: string) => new Date(`${d}T05:00:00Z`); // 10:30 IST

async function oneCheckGoal() {
  await createGoal(env.DB, 'u1', { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  return toSnapshot(await listActiveGoals(env.DB, 'u1'));
}

it('does not grade yesterday before noon', () => {
  // 10:30 IST on the 27th: only the 25th and earlier are gradable
  expect(lastGradableDate(beforeNoon('2026-08-27'))).toBe('2026-08-25');
});

it('grades yesterday from noon onward', () => {
  expect(lastGradableDate(afterNoon('2026-08-27'))).toBe('2026-08-26');
});

it('materialises days the user never opened and strikes them', async () => {
  await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-24', 1);

  // Nobody opened the app. Now it is 12:30 IST on the 27th.
  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));

  const days = await listDays(env.DB, run.id);
  const dates = days.map((d) => d.date);
  expect(dates).toContain('2026-08-24');
  expect(dates).toContain('2026-08-25');
  expect(dates).toContain('2026-08-26');

  // 24th and 25th graded and failed; run dead before it could grade the 26th
  expect(await countStrikes(env.DB, run.id)).toBeGreaterThanOrEqual(2);
  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
});

it('passes a day where every goal was met and adds no strike', async () => {
  const snap = await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const day = await ensureDay(env.DB, run, '2026-08-26', 'u1', afterNoon('2026-08-26'));
  await setProgress(env.DB, day.id, snap[0]!.id, 1);

  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));

  expect((await getDay(env.DB, run.id, '2026-08-26'))?.state).toBe('passed');
  expect(await countStrikes(env.DB, run.id)).toBe(0);
});

it('is idempotent — a second pass changes nothing', async () => {
  await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);

  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));
  const first = await countStrikes(env.DB, run.id);
  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));
  expect(await countStrikes(env.DB, run.id)).toBe(first);
});

it('records every strike when one day exceeds the limit, and fails the run', async () => {
  for (const t of ['A', 'B', 'C', 'D']) {
    await createGoal(env.DB, 'u1', { title: t, kind: 'check', target: 1, unit: null, sortOrder: 0 });
  }
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  await ensureDay(env.DB, run, '2026-08-26', 'u1', afterNoon('2026-08-26'));

  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));

  expect(await countStrikes(env.DB, run.id)).toBe(4); // ledger keeps all four
  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
  expect((await listStrikes(env.DB, run.id)).every((s) => s.reason === 'missed_goal')).toBe(true);
});

it('grades a locked day against its snapshot, not against later goal edits', async () => {
  const snap = await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const day = await ensureDay(env.DB, run, '2026-08-26', 'u1', afterNoon('2026-08-26'));
  await setProgress(env.DB, day.id, snap[0]!.id, 1);
  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));
  expect((await getDay(env.DB, run.id, '2026-08-26'))?.state).toBe('passed');

  // Adding a goal afterwards must not retroactively fail that day
  await createGoal(env.DB, 'u1', { title: 'New', kind: 'check', target: 1, unit: null, sortOrder: 1 });
  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));
  expect((await getDay(env.DB, run.id, '2026-08-26'))?.state).toBe('passed');
  expect(await countStrikes(env.DB, run.id)).toBe(0);
});

it('does nothing when there is no active run', async () => {
  await expect(catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27')))
    .resolves.toEqual({ runFailed: false });
});
