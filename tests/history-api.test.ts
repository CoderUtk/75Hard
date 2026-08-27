import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

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
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u2', 'Priya', '#22C55E', hash, salt, Date.now()).run();
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

it('returns the current user\'s runs, newest attempt first', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'hard', startDate: today });
  const { getActiveRun } = await import('../src/db/runs');
  const first = await getActiveRun(env.DB, 'u1');
  await env.DB.prepare("UPDATE runs SET status='failed', ended_date=? WHERE id=?")
    .bind(today, first!.id).run();
  await req('/api/run/reset', 'POST');

  const res = await req('/api/history', 'GET');
  expect(res.status).toBe(200);
  const runs = await res.json<{ attempt_no: number; status: string }[]>();
  expect(runs.map((r) => r.attempt_no)).toEqual([2, 1]);
  expect(runs[1]!.status).toBe('failed');
  expect(runs[0]!.status).toBe('active');
});

it('never returns another user\'s runs', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await env.DB.prepare(
    "INSERT INTO runs (id,user_id,variant,attempt_no,start_date,status) VALUES ('rx','u2','soft',1,?,'active')",
  ).bind(today).run();

  const res = await req('/api/history', 'GET');
  const runs = await res.json<{ id: string }[]>();
  expect(runs.map((r) => r.id)).not.toContain('rx');
});
