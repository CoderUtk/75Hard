import { Hono } from 'hono';
import { z } from 'zod';
import { todayIST } from '../lib/dates';
import { displayStrikes, STRIKE_LIMIT, type GoalSnapshot } from '../lib/rules';
import { getActiveRun, listRuns } from '../db/runs';
import { listActiveGoals } from '../db/goals';
import { getProgress } from '../db/days';
import { countStrikes } from '../db/strikes';
import { ensureDay } from '../services/grading';
import { startRun } from '../services/onboarding';
import type { App } from './middleware';

export const me = new Hono<App>();

const onboardingSchema = z.object({
  variant: z.enum(['hard', 'soft']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

me.post('/onboarding', async (c) => {
  const user = c.get('user');
  const parsed = onboardingSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  if (await getActiveRun(c.env.DB, user.id)) {
    return c.json({ error: 'a run is already active' }, 409);
  }

  const run = await startRun(
    c.env.DB, user.id, parsed.data.variant, parsed.data.startDate, true,
  );
  return c.json(run);
});

me.post('/run/reset', async (c) => {
  const user = c.get('user');
  if (await getActiveRun(c.env.DB, user.id)) {
    return c.json({ error: 'run is still active' }, 409);
  }

  const { results } = await listRuns(c.env.DB, user.id);
  const previous = results[0];
  if (!previous) return c.json({ error: 'no previous run' }, 409);

  // seed = false: goals and food lists carry over untouched, regardless of
  // whether the previous run ended in 'failed' or 'done'.
  const run = await startRun(
    c.env.DB, user.id, previous.variant, todayIST(new Date()), false,
  );
  return c.json(run);
});

me.get('/', async (c) => {
  const user = c.get('user');
  const now = new Date();
  const run = await getActiveRun(c.env.DB, user.id);

  if (!run) {
    const { results } = await listRuns(c.env.DB, user.id);
    const previous = results[0] ?? null;
    return c.json({
      user,
      run: null,
      needsOnboarding: previous === null,
      lastRun: previous, // full RunRow (incl. status) so the UI can tell a win from a loss
    });
  }

  const today = todayIST(now);
  const day = await ensureDay(c.env.DB, run, today, user.id, now);
  const snapshot = JSON.parse(day.goals_snapshot) as GoalSnapshot[];
  const progress = await getProgress(c.env.DB, day.id);
  const strikes = await countStrikes(c.env.DB, run.id);

  return c.json({
    user,
    run,
    needsOnboarding: false,
    today: {
      date: day.date,
      dayNumber: day.day_number,
      state: day.state,
      goals: snapshot,
      progress,
    },
    strikes: { used: displayStrikes(strikes), limit: STRIKE_LIMIT },
  });
});
