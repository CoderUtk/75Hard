import { Hono } from 'hono';
import { z } from 'zod';
import {
  listFoodItems, createFoodItem, updateFoodItem, deleteFoodItem, isFoodItemNameConflict,
} from '../db/food';
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
