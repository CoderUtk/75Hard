import type { Env } from '../worker';
import { getUser } from '../db/users';
import { listSubsExcept, deleteSubByEndpoint } from '../db/push';
import { milestoneText } from '../push/messages';
import { sendPush, type VapidConfig, type WebPushSub } from '../push/send';

export type MilestoneDeps = {
  send: (v: VapidConfig, s: WebPushSub, payload: string) => Promise<'ok' | 'prune' | 'error'>;
};

function vapid(env: Env): VapidConfig | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
  };
}

/** One family member passed a milestone day. Notify every OTHER user who has
 *  a subscription, regardless of their own run state. Never the achiever. */
export async function sendMilestone(
  db: D1Database, env: Env, achieverUserId: string, dayNumber: number,
  deps: MilestoneDeps = { send: sendPush },
): Promise<void> {
  const cfg = vapid(env);
  if (!cfg) { console.warn('sendMilestone: VAPID not configured, skipping'); return; }

  const achiever = await getUser(db, achieverUserId);
  if (!achiever) return;

  const payload = JSON.stringify({
    title: '75 Hard', body: milestoneText(achiever.name, dayNumber), tag: 'milestone',
  });
  for (const s of await listSubsExcept(db, achieverUserId)) {
    const r = await deps.send(cfg, { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
    if (r === 'prune') await deleteSubByEndpoint(db, s.endpoint);
  }
}
