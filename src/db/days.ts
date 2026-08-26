import { newId } from '../lib/ids';
import type { GoalSnapshot, ProgressMap } from '../lib/rules';

export type DayRow = {
  id: string; run_id: string; date: string; day_number: number;
  state: 'open' | 'passed' | 'failed';
  goals_snapshot: string; locked_at: number | null;
};

export function getDay(db: D1Database, runId: string, date: string): Promise<DayRow | null> {
  return db.prepare('SELECT * FROM days WHERE run_id = ? AND date = ?')
    .bind(runId, date).first<DayRow>();
}

export async function createDay(
  db: D1Database, runId: string, date: string,
  dayNumber: number, snapshot: GoalSnapshot[],
): Promise<DayRow> {
  const id = newId();
  await db.prepare(
    `INSERT INTO days (id,run_id,date,day_number,state,goals_snapshot)
     VALUES (?,?,?,?,'open',?)`,
  ).bind(id, runId, date, dayNumber, JSON.stringify(snapshot)).run();
  return {
    id, run_id: runId, date, day_number: dayNumber,
    state: 'open', goals_snapshot: JSON.stringify(snapshot), locked_at: null,
  };
}

export async function listUnlockedDays(
  db: D1Database, runId: string, upToDate: string,
): Promise<DayRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM days WHERE run_id = ? AND locked_at IS NULL AND date <= ? ORDER BY date',
  ).bind(runId, upToDate).all<DayRow>();
  return results;
}

export async function listDays(db: D1Database, runId: string): Promise<DayRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM days WHERE run_id = ? ORDER BY date',
  ).bind(runId).all<DayRow>();
  return results;
}

/** The idempotency guard lives in the WHERE clause: a second lock is a no-op. */
export async function lockDay(
  db: D1Database, dayId: string, state: 'passed' | 'failed', at: number,
): Promise<boolean> {
  const res = await db.prepare(
    'UPDATE days SET state = ?, locked_at = ? WHERE id = ? AND locked_at IS NULL',
  ).bind(state, at, dayId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Only ever called for the current, unlocked day. */
export async function updateSnapshot(
  db: D1Database, dayId: string, snapshot: GoalSnapshot[],
): Promise<void> {
  await db.prepare('UPDATE days SET goals_snapshot = ? WHERE id = ? AND locked_at IS NULL')
    .bind(JSON.stringify(snapshot), dayId).run();
}

export async function getProgress(db: D1Database, dayId: string): Promise<ProgressMap> {
  const { results } = await db.prepare(
    'SELECT goal_id, value FROM progress WHERE day_id = ?',
  ).bind(dayId).all<{ goal_id: string; value: number }>();
  const map: ProgressMap = {};
  for (const r of results) map[r.goal_id] = r.value;
  return map;
}

export async function setProgress(
  db: D1Database, dayId: string, goalId: string, value: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO progress (day_id, goal_id, value) VALUES (?,?,?)
     ON CONFLICT (day_id, goal_id) DO UPDATE SET value = excluded.value`,
  ).bind(dayId, goalId, value).run();
}
