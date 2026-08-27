import { Hono } from 'hono';
import { z } from 'zod';
import { todayIST } from '../lib/dates';
import { getActiveRun } from '../db/runs';
import {
  listFoodItems, getFoodItem, createFoodItem, updateFoodItem, deleteFoodItem,
  isFoodItemNameConflict, listFoodLog, createMealLog, deleteMealLog,
} from '../db/food';
import { logSlip } from '../services/food';
import type { App } from './middleware';

export const food = new Hono<App>();

const itemSchema = z.object({
  name: z.string().trim().min(1).max(60),
  status: z.enum(['allowed', 'banned']),
});

food.get('/items', async (c) => {
  return c.json(await listFoodItems(c.env.DB, c.get('user').id));
});

food.post('/items', async (c) => {
  const parsed = itemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);
  try {
    const item = await createFoodItem(c.env.DB, c.get('user').id, parsed.data.name, parsed.data.status);
    return c.json(item);
  } catch (err) {
    if (isFoodItemNameConflict(err)) return c.json({ error: 'already on your list' }, 409);
    throw err;
  }
});

food.patch('/items/:id', async (c) => {
  const parsed = itemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);
  try {
    const updated = await updateFoodItem(
      c.env.DB, c.get('user').id, c.req.param('id'), parsed.data.name, parsed.data.status,
    );
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  } catch (err) {
    if (isFoodItemNameConflict(err)) return c.json({ error: 'already on your list' }, 409);
    throw err;
  }
});

food.delete('/items/:id', async (c) => {
  const deleted = await deleteFoodItem(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!deleted) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const logSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('meal'), text: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal('slip'), foodItemId: z.string().min(1) }),
]);

food.get('/log', async (c) => {
  const date = c.req.query('date');
  if (!date || !DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);
  const user = c.get('user');
  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 404);
  return c.json(await listFoodLog(c.env.DB, user.id, run.id, date));
});

food.post('/log', async (c) => {
  const parsed = logSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const user = c.get('user');
  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 404);
  const now = new Date();
  const date = todayIST(now);

  if (parsed.data.kind === 'meal') {
    const log = await createMealLog(c.env.DB, user.id, run.id, date, parsed.data.text, now.getTime());
    return c.json({ log });
  }

  const item = await getFoodItem(c.env.DB, user.id, parsed.data.foodItemId);
  if (!item) return c.json({ error: 'not found' }, 404);
  if (item.status !== 'banned') return c.json({ error: 'that item is not on your banned list' }, 400);

  const result = await logSlip(c.env.DB, run, user.id, item.id, item.name, date, now.getTime());
  return c.json(result);
});

food.delete('/log/:id', async (c) => {
  const deleted = await deleteMealLog(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!deleted) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});
