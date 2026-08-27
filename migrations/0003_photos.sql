-- One progress photo per user per calendar date. Private to the uploader:
-- every read filters by user_id, and the bytes live in a private R2 bucket
-- served only through GET /api/photos/:date. The r2_key is deterministic
-- ({userId}/{runId}/{date}.jpg) so a repeat upload overwrites in place.
CREATE TABLE photos (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  run_id  TEXT NOT NULL REFERENCES runs(id),
  date    TEXT NOT NULL,
  r2_key  TEXT NOT NULL,
  at      INTEGER NOT NULL,
  UNIQUE (user_id, date)
);
