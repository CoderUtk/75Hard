import { Hono } from 'hono';
import { todayIST } from '../lib/dates';
import { getActiveRun } from '../db/runs';
import { getPhoto, listPhotoDates, upsertPhoto } from '../db/photos';
import type { App } from './middleware';

export const photos = new Hono<App>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BYTES = 1_000_000;

photos.get('/', async (c) => {
  const dates = await listPhotoDates(c.env.DB, c.get('user').id);
  return c.json(dates.map((date) => ({ date })));
});

photos.post('/', async (c) => {
  const user = c.get('user');
  // A photo belongs to a run day. No run, nothing to attach it to.
  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 400);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get('photo');
  if (!(file instanceof File)) return c.json({ error: 'bad request' }, 400);
  if (file.type !== 'image/jpeg') return c.json({ error: 'must be a jpeg' }, 415);
  if (file.size > MAX_BYTES) return c.json({ error: 'too large' }, 413);

  // Server owns the date — never the client's clock (see food.ts).
  const now = new Date();
  const date = todayIST(now);
  const key = `${user.id}/${run.id}/${date}.jpg`;

  // Object first, then the row. A failed put leaves no row; a stray object
  // from a later-failed insert is harmless and is overwritten next upload.
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  await upsertPhoto(c.env.DB, user.id, run.id, date, key, now.getTime());
  return c.json({ date });
});

photos.get('/:date', async (c) => {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);

  // Ownership is the WHERE clause: another user's date is simply not found.
  const row = await getPhoto(c.env.DB, c.get('user').id, date);
  if (!row) return c.json({ error: 'not found' }, 404);

  const obj = await c.env.PHOTOS.get(row.r2_key);
  if (!obj) return c.json({ error: 'not found' }, 404);

  return new Response(obj.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' },
  });
});
