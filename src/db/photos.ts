import { newId } from '../lib/ids';

export type PhotoRow = {
  id: string; user_id: string; run_id: string;
  date: string; r2_key: string; at: number;
};

export function getPhoto(
  db: D1Database, userId: string, date: string,
): Promise<PhotoRow | null> {
  return db.prepare('SELECT * FROM photos WHERE user_id = ? AND date = ?')
    .bind(userId, date).first<PhotoRow>();
}

/** Every date this user has a photo for, newest first. Dates only — the
 *  bytes are fetched one at a time through GET /api/photos/:date. */
export async function listPhotoDates(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db.prepare(
    'SELECT date FROM photos WHERE user_id = ? ORDER BY date DESC',
  ).bind(userId).all<{ date: string }>();
  return results.map((r) => r.date);
}

/** Record (or refresh) the pointer to this user's photo for `date`. The
 *  caller writes the R2 object first; this only touches the row. The key is
 *  deterministic, so ON CONFLICT just refreshes `at` and `run_id` — a repeat
 *  upload overwrote the same object. */
export async function upsertPhoto(
  db: D1Database, userId: string, runId: string,
  date: string, r2Key: string, at: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO photos (id,user_id,run_id,date,r2_key,at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id,date)
       DO UPDATE SET at = excluded.at, run_id = excluded.run_id, r2_key = excluded.r2_key`,
  ).bind(newId(), userId, runId, date, r2Key, at).run();
}
