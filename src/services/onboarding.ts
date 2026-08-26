import { PRESETS } from '../presets';
import { newId } from '../lib/ids';
import { createRun, listRuns, type RunRow } from '../db/runs';
import { createGoal } from '../db/goals';

/**
 * Create a new run. `seed` is true only for a user's very first run —
 * a reset carries the existing goals and food lists forward untouched.
 */
export async function startRun(
  db: D1Database, userId: string,
  variant: 'hard' | 'soft', startDate: string, seed: boolean,
): Promise<RunRow> {
  const { results } = await listRuns(db, userId);
  const attemptNo = results.length + 1;

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

  return createRun(db, userId, variant, startDate, attemptNo);
}
