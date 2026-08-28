import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { listSubsForUser } from '../src/db/push';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_subs'), env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  for (const [id, name] of [['u1', 'A'], ['u2', 'B']] as const) {
    await env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, name, '#EA580C', hash, salt, Date.now()).run();
  }
  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

const req = (method: string, path: string, body?: unknown) =>
  SELF.fetch(`https://example.com${path}`, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

it('requires a session', async () => {
  const res = await SELF.fetch('https://example.com/api/push/subscribe', { method: 'POST', body: '{}' });
  expect(res.status).toBe(401);
});

it('rejects a malformed body', async () => {
  const res = await req('POST', '/api/push/subscribe', { endpoint: 'x' });
  expect(res.status).toBe(400);
});

it('stores a subscription', async () => {
  const res = await req('POST', '/api/push/subscribe', SUB);
  expect(res.status).toBe(200);
  const rows = await listSubsForUser(env.DB, 'u1');
  expect(rows).toHaveLength(1);
  expect(rows[0]!.endpoint).toBe(SUB.endpoint);
});

it('unsubscribe is idempotent and owner-scoped', async () => {
  await req('POST', '/api/push/subscribe', SUB);
  // u2 cannot delete u1's endpoint
  const login2 = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u2', pin: '1234' }),
  });
  const cookie2 = (login2.headers.get('set-cookie') ?? '').split(';')[0]!;
  const bad = await SELF.fetch('https://example.com/api/push/subscribe', {
    method: 'DELETE', headers: { 'content-type': 'application/json', cookie: cookie2 },
    body: JSON.stringify({ endpoint: SUB.endpoint }),
  });
  expect(bad.status).toBe(200);
  expect(await listSubsForUser(env.DB, 'u1')).toHaveLength(1);
  // owner can, and a second delete is still 200
  expect((await req('DELETE', '/api/push/subscribe', { endpoint: SUB.endpoint })).status).toBe(200);
  expect((await req('DELETE', '/api/push/subscribe', { endpoint: SUB.endpoint })).status).toBe(200);
  expect(await listSubsForUser(env.DB, 'u1')).toHaveLength(0);
});

it('returns the configured VAPID public key', async () => {
  const res = await req('GET', '/api/push/vapid-public-key');
  expect(res.status).toBe(200);
  expect((await res.json() as { key?: string }).key).toBeTruthy();
});
