import { Hono } from 'hono';
import { z } from 'zod';
import { upsertSub, deleteSub } from '../db/push';
import { vapidFromEnv } from '../push/vapid';
import type { App } from './middleware';

export const push = new Hono<App>();

const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), 'must be https');
const subscribeSchema = z.object({
  endpoint: httpsUrl,
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const unsubscribeSchema = z.object({ endpoint: z.string().url() });

const vapidConfigured = (env: App['Bindings']): boolean => vapidFromEnv(env) !== null;

push.get('/vapid-public-key', (c) => {
  if (!vapidConfigured(c.env)) return c.json({ error: 'push not configured' }, 503);
  return c.json({ key: c.env.VAPID_PUBLIC_KEY! });
});

push.post('/subscribe', async (c) => {
  // 503 gate fires before the Zod parse so it wins over 400 when keys are absent.
  if (!vapidConfigured(c.env)) return c.json({ error: 'push not configured' }, 503);
  const parsed = subscribeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);
  await upsertSub(c.env.DB, c.get('user').id, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  }, Date.now());
  return c.json({ ok: true });
});

push.delete('/subscribe', async (c) => {
  const parsed = unsubscribeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);
  await deleteSub(c.env.DB, c.get('user').id, parsed.data.endpoint);
  return c.json({ ok: true });
});
