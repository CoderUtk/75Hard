import { catchUpGrading } from './grading';
import { sendMilestone } from './milestone';
import type { Env } from '../worker';

/**
 * Grade every user with an active run. Called from the 12:00 IST cron.
 * Each user is graded independently: one user's failure must not stop the rest.
 */
export async function runDailyLock(
  db: D1Database, now: Date, env?: Env,
): Promise<{ graded: number }> {
  const { results } = await db.prepare(
    "SELECT DISTINCT user_id FROM runs WHERE status = 'active'",
  ).all<{ user_id: string }>();

  let graded = 0;
  for (const { user_id } of results) {
    try {
      await catchUpGrading(
        db, user_id, now,
        env ? (dayNumber) => sendMilestone(db, env, user_id, dayNumber) : undefined,
      );
      graded++;
    } catch (err) {
      console.error('grading failed', user_id, err);
    }
  }
  return { graded };
}
