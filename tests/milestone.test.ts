import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { catchUpGrading } from '../src/services/grading';
import { sendMilestone } from '../src/services/milestone';
import { createRun } from '../src/db/runs';
import { createGoal } from '../src/db/goals';
import { upsertSub } from '../src/db/push';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

const VAPID = { VAPID_PUBLIC_KEY: 'pk', VAPID_PRIVATE_KEY: 'sk', VAPID_SUBJECT: 'mailto:x@y.z' };
const envWith = () => ({ ...env, ...VAPID }) as any;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_subs'), env.DB.prepare('DELETE FROM strikes'),
    env.DB.prepare('DELETE FROM progress'), env.DB.prepare('DELETE FROM days'),
    env.DB.prepare('DELETE FROM goals'), env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  for (const [id, name] of [['u1', 'Utkarsh'], ['u2', 'B'], ['u3', 'C']] as const) {
    await env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, name, '#EA580C', 'h', 's', 1).run();
  }
});

it('fires the hook only on a passed day numbered 25/50/75', async () => {
  await createGoal(env.DB, 'u1', { title: 'Read', kind: 'check', target: 0, unit: null, sortOrder: 0 });
  await createRun(env.DB, 'u1', 'soft', '2026-01-01', 1);
  const hook = vi.fn().mockResolvedValue(undefined);
  await catchUpGrading(env.DB, 'u1', new Date('2026-01-26T07:00:00Z'), hook);
  expect(hook).toHaveBeenCalledTimes(1);
  expect(hook).toHaveBeenCalledWith(25);
});

it('does not fire for a non-milestone day', async () => {
  await createGoal(env.DB, 'u1', { title: 'Read', kind: 'check', target: 0, unit: null, sortOrder: 0 });
  await createRun(env.DB, 'u1', 'soft', '2026-01-01', 1);
  const hook = vi.fn().mockResolvedValue(undefined);
  await catchUpGrading(env.DB, 'u1', new Date('2026-01-11T07:00:00Z'), hook);
  expect(hook).not.toHaveBeenCalled();
});

it('a second grading pass over day 25 does not re-fire', async () => {
  await createGoal(env.DB, 'u1', { title: 'Read', kind: 'check', target: 0, unit: null, sortOrder: 0 });
  await createRun(env.DB, 'u1', 'soft', '2026-01-01', 1);
  const hook = vi.fn().mockResolvedValue(undefined);
  await catchUpGrading(env.DB, 'u1', new Date('2026-01-26T07:00:00Z'), hook);
  await catchUpGrading(env.DB, 'u1', new Date('2026-01-26T07:05:00Z'), hook);
  expect(hook).toHaveBeenCalledTimes(1);
});

it('sendMilestone notifies every other subscribed user, not the achiever', async () => {
  await upsertSub(env.DB, 'u1', { endpoint: 'https://push/u1', p256dh: 'p', auth: 'a' }, 1);
  await upsertSub(env.DB, 'u2', { endpoint: 'https://push/u2', p256dh: 'p', auth: 'a' }, 1);
  await upsertSub(env.DB, 'u3', { endpoint: 'https://push/u3', p256dh: 'p', auth: 'a' }, 1);
  const send = vi.fn().mockResolvedValue('ok');
  await sendMilestone(env.DB, envWith(), 'u1', 50, { send });
  const targets = send.mock.calls.map((c) => c[1].endpoint).sort();
  expect(targets).toEqual(['https://push/u2', 'https://push/u3']);
  expect(JSON.parse(send.mock.calls[0]![2])).toMatchObject({ body: 'Utkarsh reached Day 50 🔥' });
});

it('sendMilestone is a no-op without VAPID', async () => {
  await upsertSub(env.DB, 'u2', { endpoint: 'https://push/u2', p256dh: 'p', auth: 'a' }, 1);
  const send = vi.fn();
  await sendMilestone(
    env.DB,
    { ...env, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' } as any,
    'u1', 50, { send },
  );
  expect(send).not.toHaveBeenCalled();
});
