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

/** Soft delete. Past day snapshots keep their copy of the goal. */
export async function archiveGoal(db: D1Database, userId: string, id: string): Promise<void> {
  await db.prepare('UPDATE goals SET active = 0, archived_at = ? WHERE id = ? AND user_id = ?')
    .bind(Date.now(), id, userId).run();
}
