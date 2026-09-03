import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { runNudge } from '../src/services/nudge';
import { createRun } from '../src/db/runs';
import { createGoal } from '../src/db/goals';
import { upsertSub } from '../src/db/push';
import { ensureDay } from '../src/services/grading';
import { setProgress } from '../src/db/days';
import { getActiveRun } from '../src/db/runs';
import { todayIST } from '../src/lib/dates';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

const VAPID = { VAPID_PUBLIC_KEY: 'pk', VAPID_PRIVATE_KEY: 'sk', VAPID_SUBJECT: 'mailto:x@y.z' };
const envWith = () => ({ ...env, ...VAPID }) as any;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_subs'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM users'),
  ]);
  for (const [id, name] of [['u1', 'A'], ['u2', 'B'], ['u3', 'C']] as const) {
    await env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, name, '#EA580C', 'h', 's', 1).run();
  }
});

const now = new Date();
const TODAY = todayIST(now);

async function seedUser(uid: string, goalsLeft: number) {
  // two goals; complete (2 - goalsLeft) of them
  const g1 = await createGoal(env.DB, uid, { title: 'A', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  const g2 = await createGoal(env.DB, uid, { title: 'B', kind: 'check', target: 1, unit: null, sortOrder: 1 });
  await createRun(env.DB, uid, 'hard', TODAY, 1);
  await upsertSub(env.DB, uid, { endpoint: `https://push/${uid}`, p256dh: 'p', auth: 'a' }, 1);
  const run = await getActiveRun(env.DB, uid);
  const day = await ensureDay(env.DB, run!, TODAY, uid, now);
  const done = 2 - goalsLeft;
  if (done >= 1) await setProgress(env.DB, day.id, g1.id, 1);
  if (done >= 2) await setProgress(env.DB, day.id, g2.id, 1);
}

it('nudges only users with an incomplete day, with the right text', async () => {
  await seedUser('u1', 2); // 2 left  -> nudged
  await seedUser('u2', 0); // complete -> skipped
  // u3: active run + sub but NO goals/day -> gradeDay([]) passes -> skipped
  await createRun(env.DB, 'u3', 'hard', TODAY, 1);
  await upsertSub(env.DB, 'u3', { endpoint: 'https://push/u3', p256dh: 'p', auth: 'a' }, 1);

  const send = vi.fn().mockResolvedValue('ok');
  const res = await runNudge(env.DB, envWith(), now, { send });

  expect(res.sent).toBe(1);
  expect(send).toHaveBeenCalledTimes(1);
  const [, sub, payload] = send.mock.calls[0]!;
  expect(sub.endpoint).toBe('https://push/u1');
  expect(JSON.parse(payload)).toMatchObject({
    title: '75 Hard', body: `Day 1 — 2 goals left.`, tag: 'nudge', date: TODAY,
    actions: [{ action: 'complete', title: 'Mark today done' }],
  });
});

it('prunes a subscription the push service rejects', async () => {
  await seedUser('u1', 1);
  const send = vi.fn().mockResolvedValue('prune');
  await runNudge(env.DB, envWith(), now, { send });
  const { results } = await env.DB.prepare('SELECT * FROM push_subs').all();
  expect(results).toHaveLength(0);
});

it('is a no-op when VAPID is unconfigured', async () => {
  await seedUser('u1', 1);
  const send = vi.fn();
  const res = await runNudge(
    env.DB,
    { ...env, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' } as any,
    now,
    { send },
  );
  expect(res.sent).toBe(0);
  expect(send).not.toHaveBeenCalled();
});
