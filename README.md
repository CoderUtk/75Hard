# 75 Hard / 75 Soft — family tracker

A small, mobile-first tracker for a family running the 75 Hard or 75 Soft challenge.
Everyone gets their own goals, their own food rules and their own start date; everyone
can see how the others are doing.

Runs on a single Cloudflare Worker (API + static assets + cron) with D1 for storage.

## The rules it enforces

- **One strike per missed goal**, not per missed day. Miss two goals on a Tuesday, take
  two strikes. This is deliberate and harsh.
- **Three strikes ends the run.** Nothing is deleted — your goals and food lists carry
  over into the next attempt, which starts again at Day 1.
- **Days lock at 12:00 IST the following day.** Today is always editable; yesterday is
  editable until noon; anything older is frozen.
- **Surviving Day 75 ends the run as `done`.** Strikes take precedence: you can still
  strike out *on* day 75.
- **Goal edits apply forward only.** Each day stores a snapshot of the goals it was
  graded against, so changing a goal never rewrites history.
- **You cannot delete your last goal** — a run with no goals would auto-pass every day.

The timezone is fixed to `Asia/Kolkata`.

## Stack

| | |
|---|---|
| Runtime | Cloudflare Workers (single Worker: API, static assets, cron) |
| API | Hono + Zod validation at the boundary |
| Storage | Cloudflare D1 (SQLite) |
| Frontend | React 19, Vite 5, Tailwind v4, react-router, lucide-react |
| Auth | Name picker + 4-digit PIN (PBKDF2-SHA256, 100k iterations) |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` (real D1, in-memory) |

Workers rather than Pages because **Pages Functions have no cron triggers**, and the
nightly grading pass needs one.

## Getting started

```bash
npm install
npm run migrate:local
npm run dev
```

Seed at least one user before logging in — see [`scripts/seed-users.md`](scripts/seed-users.md).
There is no sign-up screen by design.

## Testing

```bash
npm test
```

`pretest` runs `tsc --noEmit` first, so a type error fails the suite rather than
slipping through Vitest's transpile-only path.

## Deploying

```bash
npx wrangler d1 create 75hard     # paste the returned database_id into wrangler.jsonc
npm run migrate:remote
npm run deploy
```

Then seed your users per `scripts/seed-users.md`.

## How grading works

Two things drive grading, and both are idempotent:

1. **A cron trigger at 12:00 IST** (`30 6 * * *` UTC) grades every user's newly-locked day.
2. **A backstop on every authenticated request**, so a user who opens the app after a
   week away is caught up immediately rather than waiting for the next cron.

Both call the same `catchUpGrading`, which materialises any missing day rows, grades
each day whose edit window has closed, appends strikes, then claims the day. Appending
before claiming is deliberate: a `UNIQUE(run_id, date, reason, ref_id)` index makes a
repeat append a no-op, so a crash mid-pass leaves the day unlocked and the next pass
simply redoes it. Claiming first would lose those strikes permanently.

Grading failures fail **open** — a corrupt snapshot must not 500 every authenticated
route.

## Layout

```
src/lib/       pure logic — dates.ts and rules.ts take "now" as a parameter, do no I/O
src/db/        thin D1 queries; `AND user_id = ?` is the ownership boundary
src/services/  grading, onboarding, cron
src/api/       Hono routes and auth middleware
web/           React app
migrations/    D1 schema
tests/         Vitest suites against real D1
docs/          design spec and implementation plan
```

`src/lib/` imports nothing else in the project. That is what makes the calendar and
grading rules testable without a database.

## Status

**Phase 1 is complete** — login, onboarding, daily tracking, goal editing, automatic
grading, strikes, reset, and the Day 75 completion screen. 102 tests.

Later phases, deliberately not built yet:

- **Phase 2** — Food tab: per-user allowed/banned lists, meal diary, slip logging
- **Phase 3** — Family tab and run history
- **Phase 4** — Progress photos (R2, private to the uploader)
- **Phase 5** — Push notifications and PWA install

The Food and Family nav items render disabled until their phase lands, so the layout
does not shift when they arrive.

### Known, carried

- `failed_pins` never decays: after five wrong PINs, every later wrong attempt re-locks
  the account for another 15 minutes indefinitely. Reset it manually per
  `scripts/seed-users.md`.
- `catchUpGrading` issues one query per elapsed day on every authenticated request.
  Fine at 4–5 users; batch it before that changes.
- A user who finishes Day 75 and then stays away accumulates inert `open` day rows past
  75. Harmless now, will need capping before the Phase 3 history view.
