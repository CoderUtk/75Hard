import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { getActiveRun } from '../src/db/runs';
import { getDay } from '../src/db/days';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM food_items'),
    env.DB.prepare('DELETE FROM goals'), env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u1', 'Utkarsh', '#EA580C', hash, salt, Date.now()).run();
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

async function onboard() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'soft', startDate: today });
  return today;
}

it('lists the seeded goals', async () => {
  await onboard();
  const res = await req('/api/goals', 'GET');
  expect(res.status).toBe(200);
  expect(await res.json<unknown[]>()).toHaveLength(4);
});

it('adds a goal and reflects it in today\'s snapshot', async () => {
  const today = await onboard();
  await req('/api/me', 'GET'); // materialise today
  const res = await req('/api/goals', 'POST',
    { title: 'Meditate', kind: 'duration', target: 10, unit: 'min' });
  expect(res.status).toBe(200);

  const run = await getActiveRun(env.DB, 'u1');
  const day = await getDay(env.DB, run!.id, today);
  const snap = JSON.parse(day!.goals_snapshot) as { title: string }[];
  expect(snap.map((g) => g.title)).toContain('Meditate');
});

it('rejects an invalid kind', async () => {
  await onboard();
  const res = await req('/api/goals', 'POST',
    { title: 'X', kind: 'weekly', target: 1, unit: null });
  expect(res.status).toBe(400);
});

it('rejects a target below 1', async () => {
  await onboard();
  const res = await req('/api/goals', 'POST',
    { title: 'X', kind: 'count', target: 0, unit: 'x' });
  expect(res.status).toBe(400);
});

it('archives a goal and drops it from today\'s snapshot', async () => {
  const today = await onboard();
  await req('/api/me', 'GET');
  const goals = await (await req('/api/goals', 'GET')).json<{ id: string; title: string }[]>();
  const victim = goals[0]!;

  expect((await req(`/api/goals/${victim.id}`, 'DELETE')).status).toBe(200);

  const run = await getActiveRun(env.DB, 'u1');
  const day = await getDay(env.DB, run!.id, today);
  const snap = JSON.parse(day!.goals_snapshot) as { id: string }[];
  expect(snap.map((g) => g.id)).not.toContain(victim.id);
});

it('refuses to archive the last remaining goal', async () => {
  await onboard();
  const goals = await (await req('/api/goals', 'GET')).json<{ id: string }[]>();
  // Archive down to one, which must succeed, then the last one must not.
  for (const g of goals.slice(0, -1)) {
    expect((await req(`/api/goals/${g.id}`, 'DELETE')).status).toBe(200);
  }
  const last = goals.at(-1)!;
  expect((await req(`/api/goals/${last.id}`, 'DELETE')).status).toBe(409);

  const still = await (await req('/api/goals', 'GET')).json<{ id: string }[]>();
  expect(still.map((g) => g.id)).toEqual([last.id]);
});

it('refuses to touch another user\'s goal', async () => {
  await onboard();
  await env.DB.prepare(
    "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u2','B','#fff','h','s',1)",
  ).run();
  await env.DB.prepare(
    `INSERT INTO goals (id,user_id,title,kind,target,unit,sort_order,active,created_at)
     VALUES ('gx','u2','Theirs','check',1,NULL,0,1,1)`,
  ).run();

  await req('/api/goals/gx', 'DELETE');
  const row = await env.DB.prepare('SELECT active FROM goals WHERE id = ?')
    .bind('gx').first<{ active: number }>();
  expect(row?.active).toBe(1); // untouched
});

it('does not alter a locked day\'s snapshot when a goal is later added', async () => {
  const today = await onboard();
  await req('/api/me', 'GET'); // materialise today

  const run = await getActiveRun(env.DB, 'u1');
  const day = await getDay(env.DB, run!.id, today);
  const before = day!.goals_snapshot;

  await env.DB.prepare('UPDATE days SET locked_at = ?, state = ? WHERE id = ?')
    .bind(Date.now(), 'passed', day!.id).run();

  const res = await req('/api/goals', 'POST',
    { title: 'Read', kind: 'check', target: 1, unit: null });
  expect(res.status).toBe(200);

  const after = await getDay(env.DB, run!.id, today);
  expect(after!.goals_snapshot).toBe(before);
});
