export type FamilyRow = {
  id: string; name: string; color: string;
  run_id: string | null; variant: 'hard' | 'soft' | null;
  attempt_no: number | null; start_date: string | null;
  status: 'active' | null;
  strikes: number; best_day: number | null;
};

/** One row per user, always — a user who has never onboarded still appears,
 *  with every run-derived column null. The LEFT JOIN is restricted to
 *  status='active' so a user between a failure and their reset confirm
 *  correctly shows no active run rather than their archived one.
 *
 *  `best_day` looks across ALL of the user's runs (not just the active one)
 *  so a reset does not erase a previous attempt's best-ever day. */
export function listFamily(db: D1Database): Promise<D1Result<FamilyRow>> {
  return db.prepare(`
    SELECT u.id, u.name, u.color,
           r.id AS run_id, r.variant, r.attempt_no, r.start_date, r.status,
           (SELECT COUNT(*) FROM strikes s WHERE s.run_id = r.id) AS strikes,
           (SELECT MAX(d.day_number) FROM days d
              JOIN runs r2 ON d.run_id = r2.id
             WHERE r2.user_id = u.id) AS best_day
      FROM users u
      LEFT JOIN runs r ON r.user_id = u.id AND r.status = 'active'
     ORDER BY u.name
  `).all<FamilyRow>();
}
