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

/** Prepared, unexecuted — for callers that need to submit it as part of a
 *  larger `db.batch()` (one implicit transaction) alongside other inserts. */
export function createRunStatement(
  db: D1Database, id: string, userId: string, variant: 'hard' | 'soft',
  startDate: string, attemptNo: number,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO runs (id,user_id,variant,attempt_no,start_date,status)
     VALUES (?,?,?,?,?,'active')`,
  ).bind(id, userId, variant, attemptNo, startDate);
}

export async function createRun(
  db: D1Database, userId: string, variant: 'hard' | 'soft',
  startDate: string, attemptNo: number,
): Promise<RunRow> {
  const id = newId();
  await createRunStatement(db, id, userId, variant, startDate, attemptNo).run();
  return {
    id, user_id: userId, variant, attempt_no: attemptNo,
    start_date: startDate, status: 'active', ended_date: null,
  };
}

/** `AND status = 'active'` is load-bearing: two grading passes can race (cron and
 *  the request-path backstop), and without it whichever UPDATE lands last wins —
 *  letting a struck-out run finish as 'done', or a stale pass flip a finished run
 *  to 'failed'. Only an active run may be ended, and only once. */
export async function failRun(db: D1Database, runId: string, endedDate: string): Promise<void> {
  await db.prepare("UPDATE runs SET status = 'failed', ended_date = ? WHERE id = ? AND status = 'active'")
    .bind(endedDate, runId).run();
}

export async function completeRun(db: D1Database, runId: string, endedDate: string): Promise<void> {
  await db.prepare("UPDATE runs SET status = 'done', ended_date = ? WHERE id = ? AND status = 'active'")
    .bind(endedDate, runId).run();
}

export function listRuns(db: D1Database, userId: string): Promise<D1Result<RunRow>> {
  return db.prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY attempt_no DESC')
    .bind(userId).all<RunRow>();
}
