CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  color        TEXT NOT NULL,
  pin_hash     TEXT NOT NULL,
  pin_salt     TEXT NOT NULL,
  failed_pins  INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE runs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  variant    TEXT NOT NULL CHECK (variant IN ('hard','soft')),
  attempt_no INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('active','failed','done')),
  ended_date TEXT
);
CREATE UNIQUE INDEX runs_one_active ON runs(user_id) WHERE status = 'active';

CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('check','count','duration')),
  target      INTEGER NOT NULL,
  unit        TEXT,
  sort_order  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE days (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES runs(id),
  date           TEXT NOT NULL,
  day_number     INTEGER NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('open','passed','failed')),
  goals_snapshot TEXT NOT NULL,
  locked_at      INTEGER,
  UNIQUE (run_id, date)
);

CREATE TABLE progress (
  day_id  TEXT NOT NULL REFERENCES days(id),
  goal_id TEXT NOT NULL,
  value   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day_id, goal_id)
);

CREATE TABLE food_items (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name    TEXT NOT NULL,
  status  TEXT NOT NULL CHECK (status IN ('allowed','banned')),
  UNIQUE (user_id, name)
);

CREATE TABLE food_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  run_id       TEXT NOT NULL REFERENCES runs(id),
  date         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('meal','slip')),
  text         TEXT,
  food_item_id TEXT REFERENCES food_items(id),
  at           INTEGER NOT NULL
);

CREATE TABLE strikes (
  id     TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  date   TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('missed_goal','banned_food')),
  ref_id TEXT,
  at     INTEGER NOT NULL
);

CREATE TABLE push_subs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX days_run_date   ON days(run_id, date);
CREATE INDEX strikes_run     ON strikes(run_id);
CREATE INDEX food_log_user_d ON food_log(user_id, date);
