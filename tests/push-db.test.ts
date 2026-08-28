import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import {
  upsertSub, deleteSub, deleteSubByEndpoint,
  listSubsForUser, listSubsExcept, usersToNudge,
} from '../src/db/push';
import { createRun } from '../src/db/runs';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_subs'), env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  for (const [id, name] of [['u1', 'A'], ['u2', 'B']] as const) {
    await env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, name, '#EA580C', 'h', 's', 1).run();
  }
});

const sub = (endpoint: string) => ({ endpoint, p256dh: 'p', auth: 'a' });

it('upsert dedups on endpoint and rebinds the owner', async () => {
  await upsertSub(env.DB, 'u1', sub('https://push/x'), 1);
  await upsertSub(env.DB, 'u2', sub('https://push/x'), 2); // same browser, different member
  const all = await env.DB.prepare('SELECT user_id FROM push_subs').all<{ user_id: string }>();
  expect(all.results).toHaveLength(1);
  expect(all.results[0]!.user_id).toBe('u2');
});

it("deleteSub only touches the caller's own row", async () => {
  await upsertSub(env.DB, 'u1', sub('https://push/x'), 1);
  await deleteSub(env.DB, 'u2', 'https://push/x'); // wrong owner - no-op
  expect(await listSubsForUser(env.DB, 'u1')).toHaveLength(1);
  await deleteSub(env.DB, 'u1', 'https://push/x');
  expect(await listSubsForUser(env.DB, 'u1')).toHaveLength(0);
});

it('deleteSubByEndpoint ignores ownership (prune path)', async () => {
  await upsertSub(env.DB, 'u1', sub('https://push/x'), 1);
  await deleteSubByEndpoint(env.DB, 'https://push/x');
  expect(await listSubsForUser(env.DB, 'u1')).toHaveLength(0);
});

it('listSubsExcept omits the given user', async () => {
  await upsertSub(env.DB, 'u1', sub('https://push/1'), 1);
  await upsertSub(env.DB, 'u2', sub('https://push/2'), 1);
  const rows = await listSubsExcept(env.DB, 'u1');
  expect(rows.map((r) => r.user_id)).toEqual(['u2']);
});

it('usersToNudge = active run AND has a sub', async () => {
  await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1); // active, but no sub
  await upsertSub(env.DB, 'u2', sub('https://push/2'), 1); // sub, but no run
  expect(await usersToNudge(env.DB)).toEqual([]);
  await upsertSub(env.DB, 'u1', sub('https://push/1'), 1); // now u1 has both
  expect(await usersToNudge(env.DB)).toEqual(['u1']);
});
