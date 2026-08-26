import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u1', 'Utkarsh', '#EA580C', hash, salt, Date.now()).run();
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

it('lists users without leaking pin material', async () => {
  const res = await SELF.fetch('https://example.com/api/auth/users');
  expect(res.status).toBe(200);
  const users = await res.json<{ id: string; name: string; color: string }[]>();
  expect(users).toHaveLength(1);
  expect(JSON.stringify(users)).not.toContain('pin');
});

it('logs in with the right pin and sets an HttpOnly cookie', async () => {
  const res = await post('/api/auth/login', { userId: 'u1', pin: '1234' });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie') ?? '';
  expect(cookie).toContain('sid=');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
});

it('rejects the wrong pin', async () => {
  const res = await post('/api/auth/login', { userId: 'u1', pin: '9999' });
  expect(res.status).toBe(401);
});

it('locks the account after five failures', async () => {
  for (let i = 0; i < 5; i++) await post('/api/auth/login', { userId: 'u1', pin: '9999' });
  // even the correct pin is refused while locked
  const res = await post('/api/auth/login', { userId: 'u1', pin: '1234' });
  expect(res.status).toBe(429);
});

it('clears the failure counter on a successful login', async () => {
  await post('/api/auth/login', { userId: 'u1', pin: '9999' });
  await post('/api/auth/login', { userId: 'u1', pin: '1234' });
  const row = await env.DB.prepare('SELECT failed_pins FROM users WHERE id = ?')
    .bind('u1').first<{ failed_pins: number }>();
  expect(row?.failed_pins).toBe(0);
});

it('refuses protected routes without a session', async () => {
  const res = await SELF.fetch('https://example.com/api/me');
  expect(res.status).toBe(401);
});

it('accepts protected routes with a session', async () => {
  const login = await post('/api/auth/login', { userId: 'u1', pin: '1234' });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  const res = await SELF.fetch('https://example.com/api/me', { headers: { cookie } });
  expect(res.status).toBe(200);
});
