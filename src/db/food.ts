import { newId } from '../lib/ids';

export type FoodItemRow = {
  id: string; user_id: string; name: string; status: 'allowed' | 'banned';
};

export async function listFoodItems(db: D1Database, userId: string): Promise<FoodItemRow[]> {
  const { results } = await db.prepare('SELECT * FROM food_items WHERE user_id = ? ORDER BY name')
    .bind(userId).all<FoodItemRow>();
  return results;
}

export function getFoodItem(db: D1Database, userId: string, id: string): Promise<FoodItemRow | null> {
  return db.prepare('SELECT * FROM food_items WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<FoodItemRow>();
}

/** Prepared, unexecuted — for callers that need to submit it as part of a
 *  larger `db.batch()` (one implicit transaction) alongside other inserts.
 *  Used by services/onboarding.ts to seed the Hard/Soft preset's starter
 *  banned list alongside the run and goal rows. */
export function createBannedFoodStatement(
  db: D1Database, userId: string, name: string,
): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO food_items (id,user_id,name,status) VALUES (?,?,?,'banned')",
  ).bind(newId(), userId, name);
}

export async function createFoodItem(
  db: D1Database, userId: string, name: string, status: 'allowed' | 'banned',
): Promise<FoodItemRow> {
  const id = newId();
  await db.prepare('INSERT INTO food_items (id,user_id,name,status) VALUES (?,?,?,?)')
    .bind(id, userId, name, status).run();
  return { id, user_id: userId, name, status };
}

/** Ownership is the WHERE clause. Returns false for a wrong owner or a
 *  missing id — the caller maps that to 404. */
export async function updateFoodItem(
  db: D1Database, userId: string, id: string, name: string, status: 'allowed' | 'banned',
): Promise<boolean> {
  const res = await db.prepare('UPDATE food_items SET name = ?, status = ? WHERE id = ? AND user_id = ?')
    .bind(name, status, id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Nulls out any food_log rows referencing this item before deleting it, in
 *  one atomic `db.batch()` — the FK on food_log.food_item_id has no ON
 *  DELETE clause, so deleting an item that's ever been logged as a slip
 *  would otherwise 500 with a FOREIGN KEY constraint failure. A slip's
 *  `text` already snapshots the item's name, so the diary entry survives
 *  unchanged. */
export async function deleteFoodItem(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.batch([
    db.prepare('UPDATE food_log SET food_item_id = NULL WHERE food_item_id = ? AND user_id = ?')
      .bind(id, userId),
    db.prepare('DELETE FROM food_items WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return (res[1]?.meta.changes ?? 0) > 0;
}

/** True iff `err` is the UNIQUE(user_id,name) violation from createFoodItem
 *  or updateFoodItem — this user already has an item with this exact name.
 *  Matched on the D1 error text for that index, same pattern as
 *  services/onboarding.ts's isActiveRunConflict. */
export function isFoodItemNameConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed: food_items');
}

export type FoodLogRow = {
  id: string; user_id: string; run_id: string; date: string;
  kind: 'meal' | 'slip'; text: string | null; food_item_id: string | null; at: number;
};

export async function listFoodLog(db: D1Database, userId: string, date: string): Promise<FoodLogRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM food_log WHERE user_id = ? AND date = ? ORDER BY at',
  ).bind(userId, date).all<FoodLogRow>();
  return results;
}

export async function createMealLog(
  db: D1Database, userId: string, runId: string, date: string, text: string, at: number,
): Promise<FoodLogRow> {
  const id = newId();
  await db.prepare(
    `INSERT INTO food_log (id,user_id,run_id,date,kind,text,food_item_id,at)
     VALUES (?,?,?,?,'meal',?,NULL,?)`,
  ).bind(id, userId, runId, date, text, at).run();
  return { id, user_id: userId, run_id: runId, date, kind: 'meal', text, food_item_id: null, at };
}

/** Prepared, unexecuted — batched atomically with its strike row by
 *  services/food.ts's logSlip, so a slip and its strike always land
 *  together. `text` snapshots the item's name at log time — see the
 *  global constraints on why this survives a later rename or delete. */
export function createSlipLogStatement(
  db: D1Database, id: string, userId: string, runId: string,
  date: string, foodItemId: string, name: string, at: number,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO food_log (id,user_id,run_id,date,kind,text,food_item_id,at)
     VALUES (?,?,?,?,'slip',?,?,?)`,
  ).bind(id, userId, runId, date, name, foodItemId, at);
}

/** Meals only — ownership plus kind='meal' in the WHERE clause. Slips are
 *  never deletable: a strike, once earned, stands (spec §6). */
export async function deleteMealLog(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(
    "DELETE FROM food_log WHERE id = ? AND user_id = ? AND kind = 'meal'",
  ).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
