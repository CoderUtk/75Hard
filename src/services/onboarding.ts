import { PRESETS } from '../presets';
import { newId } from '../lib/ids';
import { createRun, listRuns, type RunRow } from '../db/runs';
import { createGoal } from '../db/goals';

/**
 * Create a new run. `seed` is true only for a user's very first run —
 * a reset carries the existing goals and food lists forward untouched.
 *
 * The run row is created FIRST, before any seeding. `runs_one_active`
 * (a partial unique index on runs.user_id WHERE status='active') rejects a
 * second concurrent run for the same user — creating the run first means
 * that rejection happens before any goal/food-item rows are written, so a
 * losing race never leaves orphaned seed data behind.
 */
export async function startRun(
  db: D1Database, userId: string,
  variant: 'hard' | 'soft', startDate: string, seed: boolean,
): Promise<RunRow> {
  const { results } = await listRuns(db, userId);
  const attemptNo = results.length + 1;

  const run = await createRun(db, userId, variant, startDate, attemptNo);

  if (seed) {
    const preset = PRESETS[variant];
    let order = 0;
    for (const g of preset.goals) {
      await createGoal(db, userId, {
        title: g.title, kind: g.kind, target: g.target, unit: g.unit, sortOrder: order++,
      });
    }
    const stmt = db.prepare(
      "INSERT INTO food_items (id,user_id,name,status) VALUES (?,?,?,'banned')",
    );
    await db.batch(preset.banned.map((name) => stmt.bind(newId(), userId, name)));
  }

  return run;
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
