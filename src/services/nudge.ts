import type { Env } from '../worker';
import { todayIST } from '../lib/dates';
import { gradeDay, type GoalSnapshot } from '../lib/rules';
import { getActiveRun } from '../db/runs';
import { getProgress } from '../db/days';
import { ensureDay } from './grading';
import { usersToNudge, listSubsForUser, deleteSubByEndpoint } from '../db/push';
import { nudgeText } from '../push/messages';
import { sendPush, type VapidConfig, type WebPushSub } from '../push/send';

export type NudgeDeps = {
  send: (v: VapidConfig, s: WebPushSub, payload: string) => Promise<'ok' | 'prune' | 'error'>;
};

function vapid(env: Env): VapidConfig | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
  };
}

/** 21:00 IST pass. For every user with an active run and a subscription,
 *  count today's incomplete goals; if any, push a nudge to each of their
 *  subscriptions. A dead subscription (send → 'prune') is deleted. */
export async function runNudge(
  db: D1Database, env: Env, now: Date, deps: NudgeDeps = { send: sendPush },
): Promise<{ sent: number }> {
  const cfg = vapid(env);
  if (!cfg) {
    console.warn('runNudge: VAPID not configured, skipping');
    return { sent: 0 };
  }

  const today = todayIST(now);
  let sent = 0;

  for (const userId of await usersToNudge(db)) {
    try {
      const run = await getActiveRun(db, userId);
      if (!run) continue;
      const day = await ensureDay(db, run, today, userId, now);
      const snapshot = JSON.parse(day.goals_snapshot) as GoalSnapshot[];
      const progress = await getProgress(db, day.id);
      const goalsLeft = gradeDay(snapshot, progress).missedGoalIds.length;
      if (goalsLeft === 0) continue;

      const payload = JSON.stringify({
        title: '75 Hard', body: nudgeText(day.day_number, goalsLeft), tag: 'nudge',
      });
      for (const s of await listSubsForUser(db, userId)) {
        const r = await deps.send(cfg, { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
        if (r === 'prune') await deleteSubByEndpoint(db, s.endpoint);
        else if (r === 'ok') sent++;
      }
    } catch (err) {
      console.error('runNudge: user failed', userId, err);
    }
  }
  return { sent };
}
