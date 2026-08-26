import { PRESETS } from '../presets';
import { newId } from '../lib/ids';
import { createRunStatement, listRuns, type RunRow } from '../db/runs';
import { createGoalStatement } from '../db/goals';
import { createBannedFoodStatement } from '../db/food';

/**
 * Create a new run. `seed` is true only for a user's very first run —
 * a reset carries the existing goals and food lists forward untouched.
 *
 * The run insert and every seed row are submitted as ONE `db.batch()` call.
 * D1 runs a batch inside an implicit transaction, so either all of them
 * land or none do — a seeding failure can never leave a run stuck
 * `status='active'` with partial/zero goals (which would 409-lock the user
 * out of onboarding and reset forever), and a losing race on
 * `runs_one_active` never leaves orphaned goal/food rows behind either.
 */
export async function startRun(
  db: D1Database, userId: string,
  variant: 'hard' | 'soft', startDate: string, seed: boolean,
): Promise<RunRow> {
  const { results } = await listRuns(db, userId);
  const attemptNo = results.length + 1;

  const runId = newId();
  const statements = [createRunStatement(db, runId, userId, variant, startDate, attemptNo)];

  if (seed) {
    const preset = PRESETS[variant];
    preset.goals.forEach((g, order) => {
      statements.push(createGoalStatement(db, newId(), userId, {
        title: g.title, kind: g.kind, target: g.target, unit: g.unit, sortOrder: order,
      }));
    });
    for (const name of preset.banned) {
      statements.push(createBannedFoodStatement(db, userId, name));
    }
  }

  await db.batch(statements);

  return {
    id: runId, user_id: userId, variant, attempt_no: attemptNo,
    start_date: startDate, status: 'active', ended_date: null,
  };
}

/**
 * True iff `err` is the D1 error thrown when two concurrent requests both
 * pass the `getActiveRun` pre-check and race to insert a run: the
 * `runs_one_active` partial unique index rejects the loser. Matched on the
 * exact column D1 names in its message, so a genuinely different failure
 * (a D1 outage, a bug elsewhere) is never mistaken for this race.
 */
export function isActiveRunConflict(err: unknown): boolean {
  return err instanceof Error
    && err.message.includes('UNIQUE constraint failed: runs.user_id');
}
