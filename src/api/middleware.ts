import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { sha256 } from '../lib/password';
import { getSessionUser, type PublicUser } from '../db/users';
import { catchUpGrading } from '../services/grading';
import type { Env } from '../worker';

export const COOKIE_NAME = 'sid';

export type Vars = { user: PublicUser };
export type App = { Bindings: Env; Variables: Vars };

export async function requireAuth(c: Context<App>, next: Next) {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw) return c.json({ error: 'unauthorised' }, 401);

  const user = await getSessionUser(c.env.DB, await sha256(raw), Date.now());
  if (!user) return c.json({ error: 'unauthorised' }, 401);

  c.set('user', user);

  // Backstop for a missed cron. Idempotent — see services/grading.ts.
  await catchUpGrading(c.env.DB, user.id, new Date());

  await next();
}
