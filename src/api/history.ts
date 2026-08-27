import { Hono } from 'hono';
import { listRuns } from '../db/runs';
import type { App } from './middleware';

export const history = new Hono<App>();

history.get('/', async (c) => {
  const { results } = await listRuns(c.env.DB, c.get('user').id);
  return c.json(results);
});
