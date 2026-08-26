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

/** Appends one row per entry. Never clamps — see the global constraints.
 *
 *  `INSERT OR IGNORE` against the `strikes_dedup` unique index makes a repeat
 *  append a no-op, so callers may append before claiming a day and retry
 *  safely after a crash. */
export async function addStrikes(
  db: D1Database, runId: string, date: string,
  reason: 'missed_goal' | 'banned_food', refIds: (string | null)[], at: number,
): Promise<void> {
  if (refIds.length === 0) return;
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO strikes (id,run_id,date,reason,ref_id,at) VALUES (?,?,?,?,?,?)',
  );
  await db.batch(refIds.map((ref) => stmt.bind(newId(), runId, date, reason, ref, at)));
}

export async function listStrikes(db: D1Database, runId: string): Promise<StrikeRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM strikes WHERE run_id = ? ORDER BY at',
  ).bind(runId).all<StrikeRow>();
  return results;
}
