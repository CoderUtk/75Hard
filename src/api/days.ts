import { Hono } from 'hono';
import { z } from 'zod';
import { isEditable, todayIST } from '../lib/dates';
import type { GoalSnapshot } from '../lib/rules';
import { getActiveRun } from '../db/runs';
import { getProgress, setProgress } from '../db/days';
import { ensureDay } from '../services/grading';
import type { App } from './middleware';

export const days = new Hono<App>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const valueSchema = z.object({ value: z.number().int().min(0).max(100_000) });

days.get('/:date', async (c) => {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);

  const user = c.get('user');
  const now = new Date();
  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 404);
  if (date < run.start_date || date > todayIST(now)) {
    return c.json({ error: 'outside the run' }, 404);
  }

  const day = await ensureDay(c.env.DB, run, date, user.id, now);
  return c.json({
    date: day.date,
    dayNumber: day.day_number,
    state: day.state,
    editable: day.locked_at === null && isEditable(date, now),
    goals: JSON.parse(day.goals_snapshot) as GoalSnapshot[],
    progress: await getProgress(c.env.DB, day.id),
  });
});

days.put('/:date/goals/:goalId', async (c) => {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);

  const parsed = valueSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const user = c.get('user');
  const now = new Date();

  if (!isEditable(date, now)) return c.json({ error: 'day is locked' }, 409);

  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 404);
  if (date < run.start_date) return c.json({ error: 'outside the run' }, 409);

  // Same as the GET path: today's row (and, near the lock boundary,
  // yesterday's) may not exist yet — create it on demand, idempotently.
  const day = await ensureDay(c.env.DB, run, date, user.id, now);
  if (day.locked_at !== null) return c.json({ error: 'day is locked' }, 409);

  // The snapshot is the authority on which goals this day has.
  const snapshot = JSON.parse(day.goals_snapshot) as GoalSnapshot[];
  const goalId = c.req.param('goalId');
  if (!snapshot.some((g) => g.id === goalId)) {
    return c.json({ error: 'goal not in this day' }, 404);
  }

  await setProgress(c.env.DB, day.id, goalId, parsed.data.value);
  return c.json({ ok: true });
});
