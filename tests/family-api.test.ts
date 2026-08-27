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

type FamilyMember = {
  id: string; name: string; color: string;
  variant: 'hard' | 'soft' | null; attemptNo: number | null;
  dayNumber: number | null; strikes: number; strikeLimit: number;
  status: 'active' | null; bestDay: number | null;
};

it('lists every user, including one who has never onboarded', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'hard', startDate: today });

  const res = await req('/api/family', 'GET');
  expect(res.status).toBe(200);
  const members = await res.json<FamilyMember[]>();
  expect(members).toHaveLength(2);

  const u1 = members.find((m) => m.id === 'u1')!;
  expect(u1.status).toBe('active');
  expect(u1.variant).toBe('hard');
  expect(u1.attemptNo).toBe(1);
  expect(u1.dayNumber).toBe(1);
  expect(u1.strikes).toBe(0);
  expect(u1.strikeLimit).toBe(3);

  const u2 = members.find((m) => m.id === 'u2')!;
  expect(u2.status).toBeNull();
  expect(u2.variant).toBeNull();
  expect(u2.dayNumber).toBeNull();
  expect(u2.bestDay).toBeNull();
});

it('caps the displayed strike count at the limit even past overflow', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'hard', startDate: today });
  const { getActiveRun } = await import('../src/db/runs');
  const run = await getActiveRun(env.DB, 'u1');
  // Simulate a grading pass that appended 4 strikes in one go (spec §5.6 overflow).
  await env.DB.batch([1, 2, 3, 4].map((n) =>
    env.DB.prepare('INSERT INTO strikes (id,run_id,date,reason,ref_id,at) VALUES (?,?,?,?,?,?)')
      .bind(`s${n}`, run!.id, today, 'missed_goal', `g${n}`, Date.now())));

  const res = await req('/api/family', 'GET');
  const members = await res.json<FamilyMember[]>();
  const u1 = members.find((m) => m.id === 'u1')!;
  expect(u1.strikes).toBe(3); // displayStrikes caps at STRIKE_LIMIT
});
