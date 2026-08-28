import { newId } from '../lib/ids';

export type PushSubRow = {
  id: string; user_id: string; endpoint: string;
  p256dh: string; auth: string; created_at: number;
};

/** One row per browser install. `endpoint` is UNIQUE — a re-subscribe from
 *  the same browser (possibly by a different family member on a shared
 *  device) rebinds user_id and refreshes the keys. */
export async function upsertSub(
  db: D1Database, userId: string,
  sub: { endpoint: string; p256dh: string; auth: string }, now: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO push_subs (id,user_id,endpoint,p256dh,auth,created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).bind(newId(), userId, sub.endpoint, sub.p256dh, sub.auth, now).run();
}

/** Ownership boundary: a user can only remove their own subscription. */
export async function deleteSub(db: D1Database, userId: string, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?')
    .bind(endpoint, userId).run();
}

/** Prune path: the push service returned 404/410, so this endpoint is dead
 *  no matter who owns it. */
export async function deleteSubByEndpoint(db: D1Database, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
}

export async function listSubsForUser(db: D1Database, userId: string): Promise<PushSubRow[]> {
  const { results } = await db.prepare('SELECT * FROM push_subs WHERE user_id = ?')
    .bind(userId).all<PushSubRow>();
  return results;
}

export async function listSubsExcept(db: D1Database, userId: string): Promise<PushSubRow[]> {
  const { results } = await db.prepare('SELECT * FROM push_subs WHERE user_id != ?')
    .bind(userId).all<PushSubRow>();
  return results;
}

/** user_ids that have BOTH an active run and at least one subscription. */
export async function usersToNudge(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT DISTINCT r.user_id
       FROM runs r
       JOIN push_subs p ON p.user_id = r.user_id
      WHERE r.status = 'active'`,
  ).all<{ user_id: string }>();
  return results.map((r: { user_id: string }) => r.user_id);
}
