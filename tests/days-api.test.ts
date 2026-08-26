import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { todayIST, addDays } from '../src/lib/dates';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
let today = '';
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
  today = todayIST(new Date());
  await SELF.fetch('https://example.com/api/onboarding', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ variant: 'soft', startDate: today }),
  });
});

const req = (path: string, method: string, body?: unknown, extraCookie?: string) =>
  SELF.fetch(`https://example.com${path}`, {
    method, headers: { 'content-type': 'application/json', cookie: extraCookie ?? cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function firstGoalId(): Promise<string> {
  const goals = await (await req('/api/goals', 'GET')).json<{ id: string }[]>();
  return goals[0]!.id;
}

it('returns today with its goals and zeroed progress', async () => {
  const res = await req(`/api/days/${today}`, 'GET');
  expect(res.status).toBe(200);
  const day = await res.json<{ dayNumber: number; goals: unknown[]; editable: boolean }>();
  expect(day.dayNumber).toBe(1);
  expect(day.goals).toHaveLength(4);
  expect(day.editable).toBe(true);
});

it('records progress and reads it back', async () => {
  const gid = await firstGoalId();
  expect((await req(`/api/days/${today}/goals/${gid}`, 'PUT', { value: 30 })).status).toBe(200);

  const day = await (await req(`/api/days/${today}`, 'GET'))
    .json<{ progress: Record<string, number> }>();
  expect(day.progress[gid]).toBe(30);
});

it('rejects a negative value', async () => {
  const gid = await firstGoalId();
  const res = await req(`/api/days/${today}/goals/${gid}`, 'PUT', { value: -1 });
  expect(res.status).toBe(400);
});

it('rejects a malformed date', async () => {
  expect((await req('/api/days/26-08-2026', 'GET')).status).toBe(400);
});

it('refuses writes to a date outside the edit window', async () => {
  const old = addDays(today, -5);
  const gid = await firstGoalId();
  const res = await req(`/api/days/${old}/goals/${gid}`, 'PUT', { value: 1 });
  expect(res.status).toBe(409);
});

it('refuses writes to a future date', async () => {
  const gid = await firstGoalId();
  const res = await req(`/api/days/${addDays(today, 1)}/goals/${gid}`, 'PUT', { value: 1 });
  expect(res.status).toBe(409);
});

it('refuses a goal id that is not in that day\'s snapshot', async () => {
  const res = await req(`/api/days/${today}/goals/not-a-real-goal`, 'PUT', { value: 1 });
  expect(res.status).toBe(404);
});

it('refuses writes to a day already locked, even within the edit window', async () => {
  const gid = await firstGoalId();
  // Materialise today's row, then lock it directly to simulate an already-graded day.
  await req(`/api/days/${today}`, 'GET');
  await env.DB.prepare(
    "UPDATE days SET locked_at = ?, state = 'failed' WHERE date = ?",
  ).bind(Date.now(), today).run();

  const res = await req(`/api/days/${today}/goals/${gid}`, 'PUT', { value: 1 });
  expect(res.status).toBe(409);
});

it('never lets user B write to user A\'s day', async () => {
  const gidA = await firstGoalId();

  // Create user B with their own run.
  const { hash, salt } = await hashPin('5678');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u2', 'Bee', '#0EA5E9', hash, salt, Date.now()).run();
  const loginB = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u2', pin: '5678' }),
  });
  const cookieB = (loginB.headers.get('set-cookie') ?? '').split(';')[0]!;
  await SELF.fetch('https://example.com/api/onboarding', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieB },
    body: JSON.stringify({ variant: 'soft', startDate: today }),
  });

  const res = await req(`/api/days/${today}/goals/${gidA}`, 'PUT', { value: 42 }, cookieB);
  expect(res.status).not.toBe(200);
  expect([404, 409]).toContain(res.status);

  // Confirm A's progress is unchanged.
  const dayA = await (await req(`/api/days/${today}`, 'GET'))
    .json<{ progress: Record<string, number> }>();
  expect(dayA.progress[gidA]).toBeUndefined();
});
