// no imports needed: ids for users and sessions are supplied by the caller

export type UserRow = {
  id: string; name: string; color: string;
  pin_hash: string; pin_salt: string;
  failed_pins: number; locked_until: number | null;
};

export type PublicUser = { id: string; name: string; color: string };

export function listUsersPublic(db: D1Database): Promise<D1Result<PublicUser>> {
  return db.prepare('SELECT id, name, color FROM users ORDER BY name').all<PublicUser>();
}

export function getUser(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function recordPinFailure(
  db: D1Database, id: string, now: number,
): Promise<void> {
  const LOCK_AFTER = 5;
  const LOCK_MS = 15 * 60 * 1000;
  await db.prepare(
    `UPDATE users
        SET failed_pins = failed_pins + 1,
            locked_until = CASE WHEN failed_pins + 1 >= ? THEN ? ELSE locked_until END
      WHERE id = ?`,
  ).bind(LOCK_AFTER, now + LOCK_MS, id).run();
}

export async function clearPinFailures(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = ?')
    .bind(id).run();
}

export async function createSession(
  db: D1Database, tokenHash: string, userId: string, expiresAt: number,
): Promise<void> {
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
    .bind(tokenHash, userId, expiresAt).run();
}

export async function getSessionUser(
  db: D1Database, tokenHash: string, now: number,
): Promise<PublicUser | null> {
  return db.prepare(
    `SELECT u.id, u.name, u.color
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(tokenHash, now).first<PublicUser>();
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}
