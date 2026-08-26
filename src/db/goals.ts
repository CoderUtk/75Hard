import { newId } from '../lib/ids';
import type { GoalKind, GoalSnapshot } from '../lib/rules';

export type GoalRow = {
  id: string; user_id: string; title: string; kind: GoalKind;
  target: number; unit: string | null; sort_order: number; active: number;
};

export async function listActiveGoals(db: D1Database, userId: string): Promise<GoalRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM goals WHERE user_id = ? AND active = 1 ORDER BY sort_order, rowid',
  ).bind(userId).all<GoalRow>();
  return results;
}

export function toSnapshot(rows: GoalRow[]): GoalSnapshot[] {
  return rows.map((g) => ({
    id: g.id, title: g.title, kind: g.kind, target: g.target, unit: g.unit,
  }));
}

/** Prepared, unexecuted — for callers that need to submit it as part of a
 *  larger `db.batch()` (one implicit transaction) alongside other inserts. */
export function createGoalStatement(
  db: D1Database, id: string, userId: string,
  g: { title: string; kind: GoalKind; target: number; unit: string | null; sortOrder: number },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO goals (id,user_id,title,kind,target,unit,sort_order,active,created_at)
     VALUES (?,?,?,?,?,?,?,1,?)`,
  ).bind(id, userId, g.title, g.kind, g.target, g.unit, g.sortOrder, Date.now());
}

export async function createGoal(
  db: D1Database, userId: string,
  g: { title: string; kind: GoalKind; target: number; unit: string | null; sortOrder: number },
): Promise<GoalRow> {
  const id = newId();
  await createGoalStatement(db, id, userId, g).run();
  return {
    id, user_id: userId, title: g.title, kind: g.kind,
    target: g.target, unit: g.unit, sort_order: g.sortOrder, active: 1,
  };
}

export async function updateGoal(
  db: D1Database, userId: string, id: string,
  g: { title: string; kind: GoalKind; target: number; unit: string | null; sortOrder: number },
): Promise<void> {
  await db.prepare(
    `UPDATE goals SET title=?, kind=?, target=?, unit=?, sort_order=?
      WHERE id=? AND user_id=?`,
  ).bind(g.title, g.kind, g.target, g.unit, g.sortOrder, id, userId).run();
}

/** Soft delete. Past day snapshots keep their copy of the goal.
 *
 *  Refuses to archive a user's last active goal: `gradeDay` passes an empty
 *  snapshot, so a user with zero goals would auto-pass every remaining day.
 *  The count is a subquery rather than a prior SELECT so the check and the
 *  write are one statement and cannot interleave with a concurrent archive.
 *
 *  Returns false if nothing was archived — wrong owner, already archived, or
 *  it was the last one. */
export async function archiveGoal(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE goals SET active = 0, archived_at = ?
      WHERE id = ? AND user_id = ? AND active = 1
        AND (SELECT COUNT(*) FROM goals WHERE user_id = ? AND active = 1) > 1`,
  ).bind(Date.now(), id, userId, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
