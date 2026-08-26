import { newId } from '../lib/ids';

export type RunRow = {
  id: string; user_id: string; variant: 'hard' | 'soft';
  attempt_no: number; start_date: string;
  status: 'active' | 'failed' | 'done'; ended_date: string | null;
};

export function getActiveRun(db: D1Database, userId: string): Promise<RunRow | null> {
  return db.prepare("SELECT * FROM runs WHERE user_id = ? AND status = 'active'")
    .bind(userId).first<RunRow>();
}

export async function createRun(
  db: D1Database, userId: string, variant: 'hard' | 'soft',
  startDate: string, attemptNo: number,
): Promise<RunRow> {
  const id = newId();
  await db.prepare(
    `INSERT INTO runs (id,user_id,variant,attempt_no,start_date,status)
     VALUES (?,?,?,?,?,'active')`,
  ).bind(id, userId, variant, attemptNo, startDate).run();
  return {
    id, user_id: userId, variant, attempt_no: attemptNo,
    start_date: startDate, status: 'active', ended_date: null,
  };
}

export async function failRun(db: D1Database, runId: string, endedDate: string): Promise<void> {
  await db.prepare("UPDATE runs SET status = 'failed', ended_date = ? WHERE id = ?")
    .bind(endedDate, runId).run();
}

export async function completeRun(db: D1Database, runId: string, endedDate: string): Promise<void> {
  await db.prepare("UPDATE runs SET status = 'done', ended_date = ? WHERE id = ?")
    .bind(endedDate, runId).run();
}

export function listRuns(db: D1Database, userId: string): Promise<D1Result<RunRow>> {
  return db.prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY attempt_no DESC')
    .bind(userId).all<RunRow>();
}
