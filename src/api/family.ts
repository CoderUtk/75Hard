import { Hono } from 'hono';
import { todayIST, dayNumber } from '../lib/dates';
import { displayStrikes, STRIKE_LIMIT } from '../lib/rules';
import { listFamily } from '../db/family';
import type { App } from './middleware';

export const family = new Hono<App>();

family.get('/', async (c) => {
  const now = new Date();
  const { results } = await listFamily(c.env.DB);
  return c.json(results.map((r) => ({
    id: r.id, name: r.name, color: r.color,
    variant: r.variant, attemptNo: r.attempt_no,
    dayNumber: r.run_id && r.start_date ? dayNumber(r.start_date, todayIST(now)) : null,
    strikes: displayStrikes(r.strikes), strikeLimit: STRIKE_LIMIT,
    status: r.status, bestDay: r.best_day,
  })));
});
