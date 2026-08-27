import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { getActiveRun } from '../src/db/runs';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
let today = '';

function req(path: string, method: string, body?: unknown) {
  return SELF.fetch(`https://example.com${path}`, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

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

  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'soft', startDate: today });
});

it('logs a meal with no effect on strikes', async () => {
  const res = await req('/api/food/log', 'POST', { kind: 'meal', text: 'Oats and eggs' });
  expect(res.status).toBe(200);
  const body = await res.json<{ log: { kind: string; text: string } }>();
  expect(body.log.kind).toBe('meal');
  expect(body.log.text).toBe('Oats and eggs');

  const list = await req(`/api/food/log?date=${today}`, 'GET');
  expect(await list.json<unknown[]>()).toHaveLength(1);

  const run = await getActiveRun(env.DB, 'u1');
  const strikes = await env.DB.prepare('SELECT COUNT(*) AS n FROM strikes WHERE run_id = ?')
    .bind(run!.id).first<{ n: number }>();
  expect(strikes?.n).toBe(0);
});

it('logging a slip appends exactly one strike', async () => {
  const item = await req('/api/food/items', 'POST', { name: 'Ice cream', status: 'banned' })
    .then((r) => r.json<{ id: string }>());

  const res = await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: item.id });
  expect(res.status).toBe(200);
  const body = await res.json<{ strikeCount: number; limit: number; runFailed: boolean }>();
  expect(body.strikeCount).toBe(1);
  expect(body.limit).toBe(3);
  expect(body.runFailed).toBe(false);

  const run = await getActiveRun(env.DB, 'u1');
  const strikes = await env.DB.prepare('SELECT COUNT(*) AS n FROM strikes WHERE run_id = ?')
    .bind(run!.id).first<{ n: number }>();
  expect(strikes?.n).toBe(1);
});

it('a third strike fails the run in the same response', async () => {
  const ids: string[] = [];
  for (const name of ['A', 'B', 'C']) {
    const item = await req('/api/food/items', 'POST', { name, status: 'banned' })
      .then((r) => r.json<{ id: string }>());
    ids.push(item.id);
  }

  await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: ids[0] });
  await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: ids[1] });
  const third = await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: ids[2] });
  const body = await third.json<{ strikeCount: number; runFailed: boolean }>();
  expect(body.strikeCount).toBe(3);
  expect(body.runFailed).toBe(true);

  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
});

it('rejects logging an item that is not on the banned list', async () => {
  const item = await req('/api/food/items', 'POST', { name: 'Chicken', status: 'allowed' })
    .then((r) => r.json<{ id: string }>());
  const res = await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: item.id });
  expect(res.status).toBe(400);
});

it('deletes a meal but refuses to delete a slip', async () => {
  const meal = await req('/api/food/log', 'POST', { kind: 'meal', text: 'Salad' })
    .then((r) => r.json<{ log: { id: string } }>());
  const delMeal = await req(`/api/food/log/${meal.log.id}`, 'DELETE');
  expect(delMeal.status).toBe(200);

  const item = await req('/api/food/items', 'POST', { name: 'Cake', status: 'banned' })
    .then((r) => r.json<{ id: string }>());
  const slip = await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: item.id })
    .then((r) => r.json<{ log: { id: string } }>());
  const delSlip = await req(`/api/food/log/${slip.log.id}`, 'DELETE');
  expect(delSlip.status).toBe(404);

  const still = await env.DB.prepare('SELECT * FROM food_log WHERE id = ?')
    .bind(slip.log.id).first();
  expect(still).not.toBeNull();
});

it('a fresh run after a reset does not see the previous run\'s diary', async () => {
  await req('/api/food/log', 'POST', { kind: 'meal', text: 'Old run meal' });
  const oldRun = await getActiveRun(env.DB, 'u1');
  await env.DB.prepare("UPDATE runs SET status='failed', ended_date=? WHERE id=?")
    .bind(today, oldRun!.id).run();

  const reset = await req('/api/run/reset', 'POST', {});
  expect(reset.status).toBe(200);

  const list = await req(`/api/food/log?date=${today}`, 'GET');
  expect(list.status).toBe(200);
  expect(await list.json<unknown[]>()).toHaveLength(0);
});

it('cannot see, delete, or slip against another user\'s food data', async () => {
  const meal = await req('/api/food/log', 'POST', { kind: 'meal', text: 'A\'s meal' })
    .then((r) => r.json<{ log: { id: string } }>());
  const item = await req('/api/food/items', 'POST', { name: 'A-Banned', status: 'banned' })
    .then((r) => r.json<{ id: string }>());

  const loginB = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u2', pin: '1234' }),
  });
  const cookieB = (loginB.headers.get('set-cookie') ?? '').split(';')[0]!;
  await SELF.fetch('https://example.com/api/onboarding', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieB },
    body: JSON.stringify({ variant: 'soft', startDate: today }),
  });

  const listB = await SELF.fetch(`https://example.com/api/food/log?date=${today}`, {
    method: 'GET', headers: { cookie: cookieB },
  });
  expect(listB.status).toBe(200);
  expect(await listB.json<unknown[]>()).toHaveLength(0);

  const delB = await SELF.fetch(`https://example.com/api/food/log/${meal.log.id}`, {
    method: 'DELETE', headers: { cookie: cookieB },
  });
  expect(delB.status).toBe(404);
  const stillThere = await env.DB.prepare('SELECT * FROM food_log WHERE id = ?')
    .bind(meal.log.id).first();
  expect(stillThere).not.toBeNull();

  const slipB = await SELF.fetch('https://example.com/api/food/log', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieB },
    body: JSON.stringify({ kind: 'slip', foodItemId: item.id }),
  });
  expect(slipB.status).toBe(404);
});

it('a slip survives its food item being deleted, keeping the name in the diary', async () => {
  const item = await req('/api/food/items', 'POST', { name: 'Beer', status: 'banned' })
    .then((r) => r.json<{ id: string }>());
  await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: item.id });
  const del = await req(`/api/food/items/${item.id}`, 'DELETE');
  expect(del.status).toBe(200);

  const list = await req(`/api/food/log?date=${today}`, 'GET');
  const entries = await list.json<{ text: string; food_item_id: string | null }[]>();
  expect(entries).toHaveLength(1);
  expect(entries[0]!.text).toBe('Beer');
  expect(entries[0]!.food_item_id).toBeNull();
});
