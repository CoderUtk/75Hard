import { Hono } from 'hono';
import { z } from 'zod';
import { todayIST } from '../lib/dates';
import { listActiveGoals, createGoal, updateGoal, archiveGoal, toSnapshot } from '../db/goals';
import { getActiveRun } from '../db/runs';
import { getDay, updateSnapshot } from '../db/days';
import type { App } from './middleware';

export const goals = new Hono<App>();

const goalSchema = z.object({
  title: z.string().trim().min(1).max(60),
  kind: z.enum(['check', 'count', 'duration']),
  target: z.number().int().min(1).max(10_000),
  unit: z.string().trim().max(20).nullable(),
});

/** Goal edits apply from today forward. Today's snapshot is rewritten;
 *  locked days are untouched because updateSnapshot ignores locked rows. */
async function refreshTodaySnapshot(db: D1Database, userId: string): Promise<void> {
  const run = await getActiveRun(db, userId);
  if (!run) return;
  const day = await getDay(db, run.id, todayIST(new Date()));
  if (!day || day.locked_at !== null) return;
  await updateSnapshot(db, day.id, toSnapshot(await listActiveGoals(db, userId)));
}

goals.get('/', async (c) => {
  return c.json(await listActiveGoals(c.env.DB, c.get('user').id));
});

goals.post('/', async (c) => {
  const parsed = goalSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const userId = c.get('user').id;
  const existing = await listActiveGoals(c.env.DB, userId);
  const goal = await createGoal(c.env.DB, userId, {
    ...parsed.data, sortOrder: existing.length,
  });
  await refreshTodaySnapshot(c.env.DB, userId);
  return c.json(goal);
});

goals.patch('/:id', async (c) => {
  const parsed = goalSchema.extend({ sortOrder: z.number().int().min(0) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const userId = c.get('user').id;
  // The user_id in the WHERE clause is the ownership check.
  await updateGoal(c.env.DB, userId, c.req.param('id'), parsed.data);
  await refreshTodaySnapshot(c.env.DB, userId);
  return c.json({ ok: true });
});

goals.delete('/:id', async (c) => {
  const userId = c.get('user').id;
  await archiveGoal(c.env.DB, userId, c.req.param('id'));
  await refreshTodaySnapshot(c.env.DB, userId);
  return c.json({ ok: true });
});
