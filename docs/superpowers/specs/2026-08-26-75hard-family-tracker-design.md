# 75 Hard / Soft — Family Tracker

**Date:** 2026-08-26
**Status:** Approved design, ready for implementation planning

A mobile-first web app for 4–5 family members running the 75 Hard or 75 Soft challenge.
Each member tracks their own daily goals, keeps their own allowed/banned food lists, and
loses their run after three strikes. Everyone can see everyone else's progress.

---

## 1. Decisions

Every decision below was made explicitly during design. They are settled; treat them as
constraints, not suggestions.

| Area | Decision |
|---|---|
| Auth | Name picker + 4-digit PIN |
| Storage | Cloudflare D1 (SQLite) |
| Visibility | Fully shared — except progress photos, which are private to the uploader |
| Variant | Each user picks Hard or Soft at onboarding; it seeds their goals |
| Strike rule | **One strike per missed goal**, plus one per banned-food slip |
| Strike limit | 3 strikes ends the run |
| Reset | Back to Day 1, strikes cleared, previous attempt archived |
| Backfill | Yesterday editable until 12:00 IST, then locked |
| Food lists | Fully per-user |
| Goal kinds | Checkbox, counter, duration |
| Slip logging | Tap the item from your own banned list |
| Start date | Per-user; everyone starts whenever they join |
| Timezone | Single fixed zone: `Asia/Kolkata` |
| Goal edits | Apply from today forward; past days frozen against their snapshot |
| Photos | Yes — uploaded and stored, private to the uploader |
| PWA | Yes, installable |
| Push | Yes — nightly nudge + milestone events (Day 25 / 50 / 75) |
| Frontend | React + Vite + Tailwind + shadcn/ui |
| Food tab shape | Diary-first |
| Meal logging | Optional. Only slips and missed goals cause strikes |
| Meal entry | Free text for normal meals; banned slips tapped from the list |
| Reset timing | Immediate, with a full-screen confirmation |

### Accepted risk: the strike rule is severe

One strike per missed goal, with a limit of three, means a single bad day with three
incomplete goals ends the run. This was raised during design, alternatives were offered
(cap at one strike per day, raise the limit), and the severe version was chosen
deliberately. It is the intended behaviour. Do not soften it during implementation.

A direct consequence: a single grading pass can append more than three strikes at once.
The engine must handle overflow without error — see §5.5.

### Visual direction: "Iron"

Dark, athletic, high-contrast. Serious tone matching the severity of the rules.

| Token | Value |
|---|---|
| `--background` | `#0F172A` |
| `--card` | `#192134` |
| `--border` | `rgba(255,255,255,0.08)` |
| `--foreground` | `#F8FAFC` |
| `--muted-foreground` | `#94A3B8` |
| `--primary` | `#EA580C` |
| `--success` | `#22C55E` |
| `--destructive` | `#EF4444` |

Fonts: **Barlow Condensed** (headings, day numbers, nav labels, all-caps) + **Barlow**
(body). Both Google Fonts, loaded with `font-display: swap`.

Icons: Lucide. No emoji as icons, anywhere.

Numeric displays (day counts, counters, times) use tabular figures to prevent layout
shift as values change.

---

## 2. Architecture

A **single Cloudflare Worker** serves static assets, the API, and scheduled jobs.

```
Worker (wrangler deploy)
├── /            React SPA  (Workers Static Assets)
├── /api/*       Hono router
└── scheduled()  12:00 IST — lock and grade yesterday
                 21:00 IST — nightly nudge push
      │
      ├── D1     all application data
      └── R2     progress photos, private
```

### Why one Worker and not Pages

Cloudflare Pages Functions do not support cron triggers, and this app needs scheduled
work (day locking, push sends). Pages would require a second deployable Worker alongside
it. Workers Static Assets covers static hosting, the API, and cron in one deploy, on the
same free tier, with the same custom-domain support.

If the Pages dashboard and per-branch preview deploys are wanted later, the fallback is
Pages for the SPA plus a scheduled Worker for cron. The application code does not change;
only the deploy target does.

### Module boundaries

| Module | Responsibility | Depends on |
|---|---|---|
| `rules/` | Pure grading logic. Given a day snapshot, progress, and food log, return strikes. No I/O. | nothing |
| `dates/` | All `Asia/Kolkata` date math: day numbers, lock windows, "today". Pure. | nothing |
| `db/` | D1 queries. One function per operation, no business logic. | D1 |
| `api/` | Hono routes. Auth, validation, calls `rules` and `db`. | all |
| `scheduled/` | Cron entry points. Calls the same grading path as `api`. | `rules`, `db`, `push` |
| `push/` | VAPID web-push send. | `db` |
| `web/` | React SPA. | API over `fetch` |

`rules/` and `dates/` being pure is the single most important structural decision here.
They hold every rule that can silently destroy someone's 40-day run, and being pure makes
them exhaustively testable without a database, a clock, or a network.

---

## 3. Data model

D1 / SQLite. All dates are `TEXT` in `YYYY-MM-DD` form, already in `Asia/Kolkata`.
All timestamps are `INTEGER` Unix epoch milliseconds (UTC), used only for ordering and
audit, never for date arithmetic.

```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL,              -- hex, for the name tile and Family tab
  pin_hash    TEXT NOT NULL,
  pin_salt    TEXT NOT NULL,
  failed_pins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,                   -- epoch ms; PIN lockout
  created_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,           -- SHA-256 of the cookie value
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  INTEGER NOT NULL
);

CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  variant      TEXT NOT NULL CHECK (variant IN ('hard','soft')),
  attempt_no   INTEGER NOT NULL,
  start_date   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('active','failed','done')),
  ended_date   TEXT
);
CREATE UNIQUE INDEX runs_one_active ON runs(user_id) WHERE status = 'active';

CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('check','count','duration')),
  target      INTEGER NOT NULL,           -- check: 1; count: units; duration: minutes
  unit        TEXT,                       -- 'glasses', 'pages', 'min'; null for check
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
  goals_snapshot TEXT NOT NULL,           -- JSON array of {id,title,kind,target,unit}
  locked_at      INTEGER,
  UNIQUE (run_id, date)
);

CREATE TABLE progress (
  day_id   TEXT NOT NULL REFERENCES days(id),
  goal_id  TEXT NOT NULL,
  value    INTEGER NOT NULL DEFAULT 0,
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
  text         TEXT,                      -- free text; used for kind='meal'
  food_item_id TEXT REFERENCES food_items(id),  -- required for kind='slip'
  at           INTEGER NOT NULL
);

CREATE TABLE strikes (
  id      TEXT PRIMARY KEY,
  run_id  TEXT NOT NULL REFERENCES runs(id),
  date    TEXT NOT NULL,
  reason  TEXT NOT NULL CHECK (reason IN ('missed_goal','banned_food')),
  ref_id  TEXT,                           -- goal_id or food_log.id
  at      INTEGER NOT NULL
);

CREATE TABLE photos (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  run_id  TEXT NOT NULL REFERENCES runs(id),
  date    TEXT NOT NULL,
  r2_key  TEXT NOT NULL,
  at      INTEGER NOT NULL,
  UNIQUE (user_id, date)
);

CREATE TABLE push_subs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

### Notes on the shape

**`goals_snapshot` is the freeze mechanism.** Goals live on the user, not the run, so
edits are simple. Each `days` row carries a JSON copy of the goals it is graded against.
Today's snapshot is rewritten whenever goals change. At lock, it stops changing forever.
This is what makes "edits apply forward, past days frozen" true rather than aspirational.

**`strikes` is an append-only ledger, not a counter.** Every strike records why it exists
and what caused it. "Strikes used" is `COUNT(*)` over the run. This makes the state
debuggable, gives the history view real content for free, and removes a whole class of
counter-drift bug.

**`runs_one_active` partial unique index** enforces at the database level that a user
cannot have two active runs. Cheaper and more reliable than checking in application code.

---

## 4. Date handling

All day boundaries are `Asia/Kolkata`. There is no per-user timezone.

```
today()                → 'YYYY-MM-DD' in Asia/Kolkata
dayNumber(start, date) → daysBetween(start, date) + 1
isEditable(date)       → date === today()
                         OR (date === yesterday() AND nowIST < 12:00)
```

Dates are computed by formatting with `Intl.DateTimeFormat` in `Asia/Kolkata` and doing
arithmetic on the resulting calendar date, never by adding milliseconds to a UTC
timestamp. India has no DST, but this rule removes the failure mode entirely rather than
relying on that.

All of `dates/` is pure and takes "now" as a parameter, so tests can pin the clock.

---

## 5. Rules engine

### 5.1 Strike sources

| Source | When it fires | Count |
|---|---|---|
| Banned food logged | Immediately, on the log request | 1 per slip |
| Goal incomplete at lock | 12:00 IST the following day | 1 per incomplete goal |

The two timings differ because the facts differ. A slip is known the instant the user
records it. A missed goal is not knowable until the day can no longer be edited. This is
correct, not inconsistent.

### 5.2 Goal completion

A goal is complete when `progress.value >= snapshot.target`.

- `check` — target 1, value 0 or 1.
- `count` — target is the number of units, e.g. 4 glasses.
- `duration` — target is minutes, e.g. 45.

The engine treats all three identically. Only the UI differs.

### 5.3 Day materialisation

A `days` row is created lazily, on the first read or write touching that date, with
`goals_snapshot` set to the user's currently active goals.

Grading therefore cannot iterate existing rows alone: a user who does not open the app for
five days has no rows for those five days, and they would silently escape grading. The
grading pass must first **materialise every missing date** from `run.start_date` up to
yesterday, snapshotting the user's current active goals for each. A day nobody opened has
no progress, so every goal in it is missed — which is the correct outcome, and exactly the
case the naive version would have let through.

### 5.4 Locking and grading

Cron at 12:00 IST, and as a backstop on every authenticated request:

```
catchUpGrading(userId):
  run = active run for user
  if no run: return

  # materialise gaps first — see 5.3
  for each date from run.start_date to yesterday():
      if no days row for (run, date):
          create day(run, date, dayNumber(run.start_date, date),
                     state='open', goals_snapshot=activeGoals(userId))

  for each day in run where locked_at IS NULL and date < today():
      snapshot = JSON.parse(day.goals_snapshot)
      missed   = [g for g in snapshot if progress(day, g) < g.target]
      for g in missed:
          append strike(run, day.date, 'missed_goal', g.id)
      day.state     = missed.length ? 'failed' : 'passed'
      day.locked_at = now
      if strikeCount(run) >= 3: failRun(run); return
```

`locked_at IS NULL` is the idempotency guard. Grading the same day twice is impossible,
so cron and the request-path backstop can both run without coordination.

The backstop exists because cron can be missed — during a deploy, an outage, or a
platform hiccup. Cron is the fast path so that strikes appear even if nobody opens the
app; the request path guarantees correctness the moment anyone does.

Note that the lock window means day `D` is graded at noon on `D+1`, while day `D+1` is
already in progress. Two days are live at once between midnight and noon. This is
intended and is what "yesterday editable until noon" means.

### 5.5 Reset

After any strike append — from either source — if `COUNT(strikes) >= 3`:

1. `runs.status = 'failed'`, `ended_date = today()`.
2. The next screen the user loads is a full-screen, non-dismissable result:
   *"Run over. Attempt #1 reached Day 12."*
3. Confirming creates a new run: `attempt_no + 1`, `start_date = today()`, status
   `active`. Goals and food lists carry over unchanged.

Nothing is deleted. Every day, strike, food entry, and photo from the failed run stays in
the database and is reachable from the history view.

**Overflow.** A single grading pass over a day with four incomplete goals appends four
strikes. The run fails. The ledger keeps all four; the UI displays `3/3`. The engine must
not error, clamp on write, or skip appends. Test this case explicitly.

### 5.6 Food slips

Logging a slip is a two-step interaction:

1. User taps an item from their own banned list.
2. A confirmation dialog names the item and the cost: *"Log ice cream? That's strike 2
   of 3."*

On confirm, one `food_log` row (`kind='slip'`) and one `strikes` row are written in the
same transaction. If that reaches three strikes, the reset screen follows immediately.

Logging a normal meal (`kind='meal'`, free text) has no effect on strikes and requires no
confirmation. Meal logging is entirely optional — a user who logs nothing all run is
never penalised for it.

---

## 6. API

All routes require a valid session cookie except `POST /api/auth/*`.
All authenticated routes call `catchUpGrading` before handling.

```
POST   /api/auth/users            list users for the login tiles (id, name, color only)
POST   /api/auth/login            {userId, pin} → sets session cookie
POST   /api/auth/logout

GET    /api/me                    user, active run, today's day + goals + progress
POST   /api/onboarding            {variant, startDate} → seeds goals + food list, creates run
POST   /api/run/reset             confirm reset after a failure → new run

GET    /api/days/:date            day detail (own; must be within the run)
PUT    /api/days/:date/goals/:id  {value} → set progress; 409 if the day is locked

GET    /api/goals
POST   /api/goals                 {title, kind, target, unit}
PATCH  /api/goals/:id
DELETE /api/goals/:id             soft delete: active=0, archived_at=now

GET    /api/food/items
POST   /api/food/items            {name, status}
PATCH  /api/food/items/:id
DELETE /api/food/items/:id

GET    /api/food/log?date=        today's diary
POST   /api/food/log              {kind:'meal', text} | {kind:'slip', foodItemId}
DELETE /api/food/log/:id          meals only; slips are not deletable

GET    /api/family                all users: day number, strikes, attempt, best day
GET    /api/history               own past runs and their outcomes

POST   /api/photos                multipart; own, one per date
GET    /api/photos/:date          owner only; 404 for anyone else

POST   /api/push/subscribe        {endpoint, keys}
DELETE /api/push/subscribe
```

Slips are not deletable. A strike, once earned, stands. This is deliberate and matches
the severity chosen for the strike rule; the confirmation dialog in §5.6 is what prevents
mis-taps.

Every request body is validated at the route boundary with Zod before reaching any logic.

---

## 7. Screens

Bottom navigation, four tabs, always visible: **Today · Food · Family · Me**.

### Login
Name tiles coloured per user, then a 4-digit PIN pad. No email, no password reset, no
account creation in the UI — users are seeded by the administrator.

### Today (default tab)
Day number and strike pips at the top, progress bar, then goal rows. Checkbox goals
toggle on tap; count and duration goals open a stepper sheet. While the grace window is
open, a banner reads *"Yesterday — locks at 12:00"* and switches the view to yesterday.
Once locked, the view is read-only and shows which goals were missed.

### Food
Diary-first. Today's entries at the top in chronological order, slips flagged in red with
their strike cost. Below that, two rows leading into the Allowed and Not-allowed list
editors, each showing a count. A primary "Log a meal" button opens the free-text sheet;
a secondary path opens the banned list for slip logging.

### Family
All members: name, day number, strike pips, attempt number, best-ever day. Fully shared.
Photos never appear here.

### Me
Goals editor (add, remove, reorder, set kind and target), food list editors, run history,
PIN change, push notification toggle with the iOS caveat stated in plain language.

### Onboarding
Runs once per user. Pick Hard or Soft, which seeds that preset's goals and a starter
banned food list; confirm the start date; done. Everything is editable afterwards.

### Reset
Full-screen, unmissable, single action. Shows the attempt number and the day reached.

### UI constraints

- Touch targets minimum 44×44 px, minimum 8 px apart.
- Body text minimum 16 px, to avoid iOS auto-zoom on inputs.
- Transitions 150–300 ms; `prefers-reduced-motion` respected.
- Text contrast 4.5:1 minimum against the dark background.
- Strike state is never conveyed by colour alone — pips carry a count label.
- `min-h-dvh`, not `100vh`. Safe-area insets respected for the bottom nav.
- Verified at 375 px width and in landscape.

---

## 8. Authentication

4-digit PIN, hashed with PBKDF2-SHA256 via WebCrypto — native to Workers, no dependency.
Sessions are 32 bytes of random, stored as SHA-256, delivered as an `HttpOnly`, `Secure`,
`SameSite=Lax` cookie with a 90-day expiry.

**Rate limiting is the actual security control.** A 4-digit PIN is 10,000 possibilities.
Five consecutive failures lock that user for 15 minutes, tracked in `users.failed_pins`
and `users.locked_until`, and reset on success.

**Stated limitation.** This is appropriate for five family members on an unlisted domain.
It is not appropriate if the URL becomes widely known. If stronger auth is wanted later,
Cloudflare Access in front of the whole Worker is free at this seat count and requires no
application code change.

---

## 9. Photos

Private R2 bucket, no public access.

Upload: the client resizes to a maximum of 1080 px on the long edge and encodes JPEG at
quality 0.8 (roughly 200 KB) before sending. The Worker streams the body to R2 under
`{userId}/{runId}/{date}.jpg` and writes the `photos` row.

Serving: only through `GET /api/photos/:date`, which checks
`photo.user_id === session.user_id` and returns 404 otherwise. There are no public URLs
and no signed links, so a photo cannot leak by URL sharing.

Capacity: 5 users × 75 days ≈ 375 files ≈ 75 MB, well inside the 10 GB free tier.

---

## 10. Push and PWA

`vite-plugin-pwa` provides the manifest, icons, and an offline application shell.
Web Push uses VAPID directly from the Worker — no third-party push service.

Two scheduled sends:

- **21:00 IST — nudge.** Sent only to users whose current day is incomplete. Body names
  what is left: *"Day 12 — 2 goals left."* Users with a complete day get nothing.
- **12:00 IST — milestone.** During the lock pass, if a day that just passed has
  `day_number` of 25, 50, or 75, the other four members are notified.

**iOS limitation.** Safari delivers web push only after the site is added to the home
screen. Android and desktop work from the browser. The Me tab states this rather than
letting the toggle fail silently.

**Deliberately skipped: offline write queue.** Losing connectivity mid-tap loses that tap.
Add a queue if this actually becomes a complaint.

---

## 11. Testing

**Rules engine — vitest, thorough.** `rules/` and `dates/` are pure, so every case is
cheap to cover and there is no database or clock to stand up. Required cases:

- One incomplete goal produces one strike; three produce three.
- A grading pass that pushes the total past three fails the run and records every strike.
- Banned food logging appends immediately; meal logging appends nothing.
- Locking is idempotent — running the pass twice over the same day changes nothing.
- Goal edits after lock do not change a locked day's outcome.
- Day-number arithmetic across month and year boundaries.
- The grace window: editable before 12:00 IST on `D+1`, rejected after.
- All three goal kinds reach completion at their target.

**API — a small set of integration tests** against `wrangler dev` with a local D1: login
including lockout, one full lock cycle, one reset, and photo access control (that user B
gets a 404 for user A's photo).

No end-to-end browser tests in v1.

---

## 12. Build order

1. **Foundation** — Worker, D1 schema, auth, Today tab, goals CRUD, rules engine, lock
   cron. This is the app.
2. **Food** — items, diary, slip logging with confirmation.
3. **Social** — Family tab, Me tab, run history.
4. **Photos** — R2 upload, private serving.
5. **Push and PWA** — manifest, install, VAPID sends.

Phases 1–3 are a complete, usable tracker. Phases 4–5 are the later-added scope and are
sequenced last on purpose: if the project stalls, what exists still works.

---

## 13. Out of scope for v1

- Offline write queue
- End-to-end browser tests
- Per-user timezones
- Email, password reset, or self-service account creation
- Photo sharing between family members
- Data export

---

## 14. Open operational items

These are deployment tasks, not design questions:

- Seed the five user rows (name, colour, initial PIN) via a one-off `wrangler d1 execute`.
- Generate a VAPID key pair and store it in Worker secrets.
- Create the R2 bucket and bind it.
- Point a custom domain at the Worker.
- Add `.superpowers/` to `.gitignore`.
