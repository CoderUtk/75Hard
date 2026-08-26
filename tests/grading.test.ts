import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { catchUpGrading, lastGradableDate, ensureDay } from '../src/services/grading';
import { createRun, getActiveRun, listRuns } from '../src/db/runs';
import { createGoal, listActiveGoals, toSnapshot } from '../src/db/goals';
import { listDays, setProgress, getDay } from '../src/db/days';
import { countStrikes, listStrikes } from '../src/db/strikes';
import { datesBetween } from '../src/lib/dates';

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
const atNoon     = (d: string) => new Date(`${d}T06:30:00Z`); // 12:00 IST exactly

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

it('grades yesterday at exactly 12:00 IST — the boundary is inclusive', () => {
  expect(lastGradableDate(atNoon('2026-08-27'))).toBe('2026-08-26');
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

  // 24th, 25th and 26th are all graded and failed (one missed goal each) —
  // it is the third strike, from the 26th, that ends the run.
  expect(await countStrikes(env.DB, run.id)).toBe(3);
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
    .resolves.toEqual({ runFailed: false, runCompleted: false });
});

it('completes the run on day 75 and does not materialise day 76', async () => {
  const snap = await oneCheckGoal();
  const start = '2026-06-13'; // day 75 lands on 2026-08-26
  const run = await createRun(env.DB, 'u1', 'hard', start, 1);

  // Every day from start through day 75 is passed, so the run survives to
  // day 75 without accumulating strikes.
  for (const date of datesBetween(start, '2026-08-26')) {
    const day = await ensureDay(env.DB, run, date, 'u1', afterNoon(date));
    await setProgress(env.DB, day.id, snap[0]!.id, 1);
  }
  const day75 = await getDay(env.DB, run.id, '2026-08-26');
  expect(day75?.day_number).toBe(75);

  const result = await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));

  expect(result).toEqual({ runFailed: false, runCompleted: true });
  expect(await countStrikes(env.DB, run.id)).toBe(0);
  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
  expect((await listRuns(env.DB, 'u1')).results.find((r) => r.id === run.id)?.status).toBe('done');
  expect(await getDay(env.DB, run.id, '2026-08-27')).toBeNull(); // no day 76
});

it('runs two concurrent grading passes over the same day without double-charging', async () => {
  await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  await ensureDay(env.DB, run, '2026-08-26', 'u1', afterNoon('2026-08-26'));
  // Goal left unmet — a single pass would append exactly one strike.

  await Promise.all([
    catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27')),
    catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27')),
  ]);

  expect(await countStrikes(env.DB, run.id)).toBe(1);
});

it('runs two concurrent passes materialising the same missing day without throwing', async () => {
  await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-24', 1);
  // Nobody opened the app — both passes race to materialise 24th/25th/26th.

  await expect(Promise.all([
    catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27')),
    catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27')),
  ])).resolves.toBeDefined();

  const days = await listDays(env.DB, run.id);
  const dates = days.map((d) => d.date);
  expect(new Set(dates).size).toBe(dates.length); // no duplicate (run_id, date) rows
});
