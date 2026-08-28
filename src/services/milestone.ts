import type { Env } from '../worker';
import { getUser } from '../db/users';
import { listSubsExcept, deleteSubByEndpoint } from '../db/push';
import { milestoneText } from '../push/messages';
import { sendPush, type SendFn } from '../push/send';
import { vapidFromEnv } from '../push/vapid';

export type MilestoneDeps = { send: SendFn };

/** One family member passed a milestone day. Notify every OTHER user who has
 *  a subscription, regardless of their own run state. Never the achiever. */
export async function sendMilestone(
  db: D1Database, env: Env, achieverUserId: string, dayNumber: number,
  deps: MilestoneDeps = { send: sendPush },
): Promise<void> {
  const cfg = vapidFromEnv(env);
  if (!cfg) { console.warn('sendMilestone: VAPID not configured, skipping'); return; }

  const achiever = await getUser(db, achieverUserId);
  if (!achiever) return;

  const payload = JSON.stringify({
    title: '75 Hard',
    body: milestoneText(achiever.name, dayNumber),
    // Per-achiever tag: simultaneous milestones on the same cron must not
    // replace each other on the device.
    tag: `milestone:${achieverUserId}`,
  });
  for (const s of await listSubsExcept(db, achieverUserId)) {
    const r = await deps.send(cfg, { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
    if (r === 'prune') await deleteSubByEndpoint(db, s.endpoint);
  }
}
