import { newId } from '../lib/ids';

export type StrikeRow = {
  id: string; run_id: string; date: string;
  reason: 'missed_goal' | 'banned_food'; ref_id: string | null; at: number;
};

export async function countStrikes(db: D1Database, runId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM strikes WHERE run_id = ?')
    .bind(runId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Prepared, unexecuted — for callers that need to submit it as part of a
 *  larger `db.batch()` alongside another insert (e.g. one food_log row plus
 *  its strike, written atomically so neither can land without the other).
 *  `INSERT OR IGNORE` against `strikes_dedup` makes a repeat append a no-op. */
export function addStrikeStatement(
  db: D1Database, runId: string, date: string,
  reason: 'missed_goal' | 'banned_food', refId: string | null, at: number,
): D1PreparedStatement {
  return db.prepare(
    'INSERT OR IGNORE INTO strikes (id,run_id,date,reason,ref_id,at) VALUES (?,?,?,?,?,?)',
  ).bind(newId(), runId, date, reason, refId, at);
}

/** Appends one row per entry. Never clamps — see the global constraints. */
export async function addStrikes(
  db: D1Database, runId: string, date: string,
  reason: 'missed_goal' | 'banned_food', refIds: (string | null)[], at: number,
): Promise<void> {
  if (refIds.length === 0) return;
  await db.batch(refIds.map((ref) => addStrikeStatement(db, runId, date, reason, ref, at)));
}

export async function listStrikes(db: D1Database, runId: string): Promise<StrikeRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM strikes WHERE run_id = ? ORDER BY at',
  ).bind(runId).all<StrikeRow>();
  return results;
}
