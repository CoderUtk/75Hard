import { newId } from '../lib/ids';
import { isRunOver, STRIKE_LIMIT } from '../lib/rules';
import { failRun, type RunRow } from '../db/runs';
import { createSlipLogStatement, type FoodLogRow } from '../db/food';
import { addStrikeStatement, countStrikes } from '../db/strikes';

export type SlipResult = {
  log: FoodLogRow;
  strikeCount: number;
  limit: number;
  runFailed: boolean;
};

/**
 * Logs a banned-food slip and its strike in one `db.batch()` — spec §5.7
 * requires both to land together, never one without the other. If this
 * pushes the run's strike count to the limit, the run is failed within the
 * same call, so the caller can redirect to the reset screen immediately
 * rather than waiting for the next grading pass.
 */
export async function logSlip(
  db: D1Database, run: RunRow, userId: string,
  foodItemId: string, foodItemName: string, date: string, at: number,
): Promise<SlipResult> {
  const id = newId();
  await db.batch([
    createSlipLogStatement(db, id, userId, run.id, date, foodItemId, foodItemName, at),
    addStrikeStatement(db, run.id, date, 'banned_food', id, at),
  ]);

  const strikeCount = await countStrikes(db, run.id);
  const runFailed = isRunOver(strikeCount);
  if (runFailed) await failRun(db, run.id, date);

  return {
    log: {
      id, user_id: userId, run_id: run.id, date,
      kind: 'slip', text: foodItemName, food_item_id: foodItemId, at,
    },
    strikeCount,
    limit: STRIKE_LIMIT,
    runFailed,
  };
}
