import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyPin, sha256 } from '../lib/password';
import { newToken } from '../lib/ids';
import {
  listUsersPublic, getUser, recordPinFailure, clearPinFailures,
  createSession, deleteSession,
} from '../db/users';
import { COOKIE_NAME, type App } from './middleware';

const SESSION_MS = 90 * 24 * 60 * 60 * 1000;

const loginSchema = z.object({
  userId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/),
});

export const auth = new Hono<App>();

auth.get('/users', async (c) => {
  const { results } = await listUsersPublic(c.env.DB);
  return c.json(results);
});

auth.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const { userId, pin } = parsed.data;
  const now = Date.now();
  const user = await getUser(c.env.DB, userId);

  // Same response for unknown user and wrong pin.
  if (!user) return c.json({ error: 'invalid credentials' }, 401);
  if (user.locked_until && user.locked_until > now) {
    return c.json({ error: 'too many attempts' }, 429);
  }

  if (!(await verifyPin(pin, user.pin_hash, user.pin_salt))) {
    await recordPinFailure(c.env.DB, user.id, now);
    return c.json({ error: 'invalid credentials' }, 401);
  }

  await clearPinFailures(c.env.DB, user.id);

  const token = newToken();
  await createSession(c.env.DB, await sha256(token), user.id, now + SESSION_MS);

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true, secure: true, sameSite: 'Lax',
    path: '/', maxAge: SESSION_MS / 1000,
  });

  return c.json({ id: user.id, name: user.name, color: user.color });
});

auth.post('/logout', async (c) => {
  const raw = getCookie(c, COOKIE_NAME);
  if (raw) await deleteSession(c.env.DB, await sha256(raw));
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});
