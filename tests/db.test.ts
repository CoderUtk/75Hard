import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { createRun, getActiveRun, failRun } from '../src/db/runs';
import { createGoal, listActiveGoals, archiveGoal, updateGoal, toSnapshot } from '../src/db/goals';
import { createDay, getProgress, setProgress, lockDay, updateSnapshot } from '../src/db/days';
import { addStrikes, countStrikes } from '../src/db/strikes';

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

it('creates and retrieves an active run, and stops retrieving it once failed', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  expect((await getActiveRun(env.DB, 'u1'))?.id).toBe(run.id);
  await failRun(env.DB, run.id, '2026-08-30');
  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
});

it('archives a goal without removing it from listings of the past', async () => {
  const g = await createGoal(env.DB, 'u1',
    { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  await createGoal(env.DB, 'u1',
    { title: 'Walk', kind: 'check', target: 1, unit: null, sortOrder: 1 });
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(2);
  expect(await archiveGoal(env.DB, 'u1', g.id)).toBe(true);
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(1);
});

it('refuses to archive the last active goal', async () => {
  const g = await createGoal(env.DB, 'u1',
    { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  // An empty snapshot grades as passed, so zero goals would auto-pass the run.
  expect(await archiveGoal(env.DB, 'u1', g.id)).toBe(false);
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(1);
});

it('upserts progress', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const goals = toSnapshot([await createGoal(env.DB, 'u1',
    { title: 'Water', kind: 'count', target: 4, unit: 'glasses', sortOrder: 0 })]);
  const day = await createDay(env.DB, run.id, '2026-08-26', 1, goals);

  await setProgress(env.DB, day.id, goals[0]!.id, 2);
  await setProgress(env.DB, day.id, goals[0]!.id, 3);
  expect(await getProgress(env.DB, day.id)).toEqual({ [goals[0]!.id]: 3 });
});

it('locks a day exactly once', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const day = await createDay(env.DB, run.id, '2026-08-26', 1, []);
  expect(await lockDay(env.DB, day.id, 'passed', 111)).toBe(true);
  expect(await lockDay(env.DB, day.id, 'failed', 222)).toBe(false);
});

it('appends every strike without clamping', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  await addStrikes(env.DB, run.id, '2026-08-26', 'missed_goal', ['g1','g2','g3','g4'], 1);
  expect(await countStrikes(env.DB, run.id)).toBe(4);
});

it('does not let a second user mutate the first user\'s goal', async () => {
  await env.DB.prepare(
    "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u2','B','#000000','h','s',1)",
  ).run();
  const g = await createGoal(env.DB, 'u1',
    { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });

  await updateGoal(env.DB, 'u2', g.id,
    { title: 'Hijacked', kind: 'count', target: 99, unit: 'x', sortOrder: 5 });
  const row = await env.DB.prepare('SELECT title, target FROM goals WHERE id = ?')
    .bind(g.id).first<{ title: string; target: number }>();
  expect(row).toEqual({ title: 'Read', target: 1 });

  // u2 needs two goals of their own, or the last-active-goal guard would block
  // the archive regardless of ownership and this assertion would prove nothing.
  await createGoal(env.DB, 'u2',
    { title: 'Own one', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  await createGoal(env.DB, 'u2',
    { title: 'Own two', kind: 'check', target: 1, unit: null, sortOrder: 1 });

  expect(await archiveGoal(env.DB, 'u2', g.id)).toBe(false);
  const activeRow = await env.DB.prepare('SELECT active FROM goals WHERE id = ?')
    .bind(g.id).first<{ active: number }>();
  expect(activeRow?.active).toBe(1);
});

it('does not let updateSnapshot touch a locked day', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const goals = toSnapshot([await createGoal(env.DB, 'u1',
    { title: 'Water', kind: 'count', target: 4, unit: 'glasses', sortOrder: 0 })]);
  const day = await createDay(env.DB, run.id, '2026-08-26', 1, goals);

  expect(await lockDay(env.DB, day.id, 'passed', 111)).toBe(true);
  await updateSnapshot(env.DB, day.id, []);

  const row = await env.DB.prepare('SELECT goals_snapshot FROM days WHERE id = ?')
    .bind(day.id).first<{ goals_snapshot: string }>();
  expect(row?.goals_snapshot).toBe(JSON.stringify(goals));
});
