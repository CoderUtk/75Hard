import { catchUpGrading } from './grading';

/**
 * Grade every user with an active run. Called from the 12:00 IST cron.
 * Each user is graded independently: one user's failure must not stop the rest.
 */
export async function runDailyLock(
  db: D1Database, now: Date,
): Promise<{ graded: number }> {
  const { results } = await db.prepare(
    "SELECT DISTINCT user_id FROM runs WHERE status = 'active'",
  ).all<{ user_id: string }>();

  let graded = 0;
  for (const { user_id } of results) {
    try {
      await catchUpGrading(db, user_id, now);
      graded++;
    } catch (err) {
      console.error('grading failed', user_id, err);
    }
  }
  return { graded };
}
