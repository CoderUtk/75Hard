import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM food_log'),
    env.DB.prepare('DELETE FROM food_items'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind('u1', 'A', '#EA580C', hash, salt, Date.now()),
    env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind('u2', 'B', '#000000', hash, salt, Date.now()),
  ]);
  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

const req = (path: string, method: string, body?: unknown) =>
  SELF.fetch(`https://example.com${path}`, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

it('creates and lists food items', async () => {
  await req('/api/food/items', 'POST', { name: 'Ice cream', status: 'banned' });
  await req('/api/food/items', 'POST', { name: 'Chicken', status: 'allowed' });
  const res = await req('/api/food/items', 'GET');
  expect(res.status).toBe(200);
  const items = await res.json<{ name: string; status: string }[]>();
  expect(items.map((i) => i.name).sort()).toEqual(['Chicken', 'Ice cream']);
});

it('rejects a duplicate name for the same user with 409', async () => {
  await req('/api/food/items', 'POST', { name: 'Cake', status: 'banned' });
  const res = await req('/api/food/items', 'POST', { name: 'Cake', status: 'allowed' });
  expect(res.status).toBe(409);
});

it('updates and deletes only the owner\'s item', async () => {
  const created = await req('/api/food/items', 'POST', { name: 'Soda', status: 'banned' })
    .then((r) => r.json<{ id: string }>());

  const patch = await req(`/api/food/items/${created.id}`, 'PATCH', { name: 'Soda', status: 'allowed' });
  expect(patch.status).toBe(200);

  const del = await req(`/api/food/items/${created.id}`, 'DELETE');
  expect(del.status).toBe(200);

  const gone = await env.DB.prepare('SELECT * FROM food_items WHERE id = ?').bind(created.id).first();
  expect(gone).toBeNull();
});

it('never lists another user\'s food items', async () => {
  await req('/api/food/items', 'POST', { name: 'A-Item', status: 'banned' });

  const loginB = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u2', pin: '1234' }),
  });
  const cookieB = (loginB.headers.get('set-cookie') ?? '').split(';')[0]!;
  await SELF.fetch('https://example.com/api/food/items', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieB },
    body: JSON.stringify({ name: 'B-Item', status: 'allowed' }),
  });

  const listB = await SELF.fetch('https://example.com/api/food/items', {
    method: 'GET', headers: { cookie: cookieB },
  }).then((r) => r.json<{ name: string }[]>());
  expect(listB.map((i) => i.name)).toEqual(['B-Item']);

  const listA = await req('/api/food/items', 'GET').then((r) => r.json<{ name: string }[]>());
  expect(listA.map((i) => i.name)).toEqual(['A-Item']);
});

it('404s a PATCH or DELETE from a user who does not own the item', async () => {
  const created = await req('/api/food/items', 'POST', { name: 'Beer', status: 'banned' })
    .then((r) => r.json<{ id: string }>());

  const loginB = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u2', pin: '1234' }),
  });
  const cookieB = (loginB.headers.get('set-cookie') ?? '').split(';')[0]!;

  const patch = await SELF.fetch(`https://example.com/api/food/items/${created.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', cookie: cookieB },
    body: JSON.stringify({ name: 'Hijacked', status: 'allowed' }),
  });
  expect(patch.status).toBe(404);

  const still = await env.DB.prepare('SELECT name FROM food_items WHERE id = ?')
    .bind(created.id).first<{ name: string }>();
  expect(still?.name).toBe('Beer');

  const del = await SELF.fetch(`https://example.com/api/food/items/${created.id}`, {
    method: 'DELETE', headers: { cookie: cookieB },
  });
  expect(del.status).toBe(404);
});
