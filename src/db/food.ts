import { newId } from '../lib/ids';

/** Prepared, unexecuted — for callers that need to submit it as part of a
 *  larger `db.batch()` (one implicit transaction) alongside other inserts. */
export function createBannedFoodStatement(
  db: D1Database, userId: string, name: string,
): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO food_items (id,user_id,name,status) VALUES (?,?,?,'banned')",
  ).bind(newId(), userId, name);
}
