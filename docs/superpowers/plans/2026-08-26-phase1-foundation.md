# 75 Hard Tracker — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Cloudflare Worker where a family member logs in with a PIN, sees their day number and goals, checks goals off, edits their goal list, and loses the run after three strikes.

**Architecture:** One Cloudflare Worker serves the React SPA (Workers Static Assets), a Hono API at `/api/*`, and a cron handler. All business rules live in two pure modules (`lib/dates.ts`, `lib/rules.ts`) with zero I/O, so they are exhaustively unit-testable. A `services/grading.ts` orchestrator is the only place that combines those pure rules with D1, and it is called from both the request path and cron.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, D1 (SQLite), React 19, Vite, Tailwind CSS v4, shadcn/ui, Zod, Vitest with `@cloudflare/vitest-pool-workers`.

**Source spec:** `docs/superpowers/specs/2026-08-26-75hard-family-tracker-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Timezone is `Asia/Kolkata` everywhere.** There is no per-user timezone.
- **All dates are `TEXT` in `YYYY-MM-DD` form, already in IST.** Never do date arithmetic by adding milliseconds to a UTC timestamp.
- **All timestamps are `INTEGER` Unix epoch milliseconds**, used only for ordering and audit.
- **The strike rule is one strike per missed goal, limit 3.** It is severe by explicit design decision. Do not soften it, do not cap per day, do not add grace.
- **A single grading pass may append more than 3 strikes.** The engine must not error, clamp on write, or skip appends. The ledger keeps all of them; only the UI displays `3/3`.
- **Day `D` is editable through 12:00 IST on `D+1`.** It must not be graded before that moment.
- **`lib/dates.ts` and `lib/rules.ts` are pure.** No `Date.now()`, no `fetch`, no D1, no imports from `db/` or `api/`. "Now" is always a parameter.
- **Slips are never deletable.** (Relevant from Phase 2 onward; do not add a delete path for them.)
- **UI:** touch targets minimum 44×44 px and 8 px apart; body text minimum 16 px; transitions 150–300 ms; `prefers-reduced-motion` respected; text contrast 4.5:1 minimum; `min-h-dvh` not `100vh`; safe-area insets respected for the bottom nav.
- **No emoji as icons, anywhere.** Icons come from `lucide-react`.
- **Numeric displays use tabular figures** (`font-variant-numeric: tabular-nums`).
- **Palette (Iron):** `--background #0F172A`, `--card #192134`, `--border rgba(255,255,255,0.08)`, `--foreground #F8FAFC`, `--muted-foreground #94A3B8`, `--primary #EA580C`, `--success #22C55E`, `--destructive #EF4444`.
- **Fonts:** Barlow Condensed (headings, day numbers, nav labels, all-caps) + Barlow (body), `font-display: swap`.
- **Strike state is never conveyed by colour alone** — pips always carry a count label.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `wrangler.jsonc` | Worker config: D1 binding, assets, cron triggers |
| `vitest.config.ts` | Vitest + workers pool config |
| `vite.config.ts` | SPA build into `dist/client` |
| `migrations/0001_init.sql` | Full D1 schema |
| `src/worker.ts` | Entry point: `fetch` and `scheduled` |
| `src/lib/dates.ts` | Pure IST calendar math |
| `src/lib/rules.ts` | Pure grading logic |
| `src/lib/ids.ts` | ID generation |
| `src/lib/password.ts` | PBKDF2 hash/verify, constant-time compare |
| `src/presets.ts` | Hard/Soft seed goals and seed food lists |
| `src/db/users.ts` | User + session queries |
| `src/db/runs.ts` | Run queries |
| `src/db/goals.ts` | Goal queries |
| `src/db/days.ts` | Day + progress queries |
| `src/db/strikes.ts` | Strike ledger queries |
| `src/services/grading.ts` | `catchUpGrading` — the only place rules meet D1 |
| `src/services/onboarding.ts` | Seed goals/food, create first run |
| `src/api/router.ts` | Hono app assembly |
| `src/api/middleware.ts` | Session auth + grading catch-up |
| `src/api/auth.ts` | `/api/auth/*` |
| `src/api/me.ts` | `/api/me`, `/api/onboarding`, `/api/run/reset` |
| `src/api/goals.ts` | `/api/goals` CRUD |
| `src/api/days.ts` | `/api/days/:date` and progress writes |
| `web/main.tsx` | React entry + router |
| `web/api.ts` | Typed fetch client |
| `web/theme.css` | Tailwind theme tokens, fonts |
| `web/components/*` | `BottomNav`, `StrikePips`, `GoalRow`, `CounterSheet` |
| `web/screens/*` | `Login`, `Onboarding`, `Today`, `GoalsEditor`, `RunOver` |
| `tests/*.test.ts` | Unit and integration tests |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `src/worker.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Env` type with `DB: D1Database`; a Worker default export with `fetch` and `scheduled`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "75hard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "vite build",
    "deploy": "npm run build && wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate:local": "wrangler d1 migrations apply DB --local",
    "migrate:remote": "wrangler d1 migrations apply DB --remote"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240909.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": ["src", "web", "tests"]
}
```

- [ ] **Step 3: Create `wrangler.jsonc`**

Cron times are UTC. 12:00 IST = 06:30 UTC. 21:00 IST = 15:30 UTC.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "75hard",
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "./dist/client", "not_found_handling": "single-page-application" },
  "d1_databases": [
    { "binding": "DB", "database_name": "75hard", "database_id": "PLACEHOLDER_SET_BY_WRANGLER" }
  ],
  "triggers": { "crons": ["30 6 * * *", "30 15 * * *"] }
}
```

Note: `database_id` is filled in by running `npx wrangler d1 create 75hard` and pasting the returned id. Do that now.

- [ ] **Step 4: Create `src/worker.ts`**

```ts
export interface Env {
  DB: D1Database;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, _env: Env): Promise<void> {
    // wired up in Task 12
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          d1Databases: ['DB'],
        },
      },
    },
  },
});
```

- [ ] **Step 6: Write the smoke test**

```ts
// tests/smoke.test.ts
import { env, SELF } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('serves the api health route', async () => {
  const res = await SELF.fetch('https://example.com/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

it('binds D1', () => {
  expect(env.DB).toBeDefined();
});
```

- [ ] **Step 7: Install and run**

Run: `npm install && npm test`
Expected: both tests PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json wrangler.jsonc vitest.config.ts src/worker.ts tests/smoke.test.ts
git commit -m "chore: scaffold worker, d1 binding, and vitest"
```

---

## Task 2: Pure IST date math

The single highest-risk module in the project. Every strike depends on it.

**Files:**
- Create: `src/lib/dates.ts`
- Test: `tests/dates.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `todayIST(now: Date): string`
  - `istMinutes(now: Date): number`
  - `addDays(date: string, n: number): string`
  - `daysBetween(from: string, to: string): number`
  - `dayNumber(startDate: string, date: string): number`
  - `datesBetween(from: string, to: string): string[]`
  - `isEditable(date: string, now: Date): boolean`
  - `LOCK_HOUR_MINUTES: number` (720)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/dates.test.ts
import { describe, it, expect } from 'vitest';
import {
  todayIST, istMinutes, addDays, daysBetween,
  dayNumber, datesBetween, isEditable,
} from '../src/lib/dates';

// 2026-08-26T18:45:00Z === 2026-08-27 00:15 IST
const lateUTC = new Date('2026-08-26T18:45:00Z');

describe('todayIST', () => {
  it('uses the IST calendar day, not the UTC one', () => {
    expect(todayIST(lateUTC)).toBe('2026-08-27');
    expect(todayIST(new Date('2026-08-26T12:00:00Z'))).toBe('2026-08-26');
  });

  it('handles the IST midnight boundary exactly', () => {
    // 18:29:59Z is 23:59:59 IST on the 26th
    expect(todayIST(new Date('2026-08-26T18:29:59Z'))).toBe('2026-08-26');
    // 18:30:00Z is 00:00:00 IST on the 27th
    expect(todayIST(new Date('2026-08-26T18:30:00Z'))).toBe('2026-08-27');
  });
});

describe('istMinutes', () => {
  it('returns 0 at IST midnight, not 1440', () => {
    expect(istMinutes(new Date('2026-08-26T18:30:00Z'))).toBe(0);
  });

  it('returns 720 at noon IST', () => {
    // 06:30Z === 12:00 IST
    expect(istMinutes(new Date('2026-08-26T06:30:00Z'))).toBe(720);
  });

  it('returns 719 one minute before noon IST', () => {
    expect(istMinutes(new Date('2026-08-26T06:29:00Z'))).toBe(719);
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('goes backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });
  it('handles a non-leap year February', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('daysBetween / dayNumber', () => {
  it('counts zero for the same day', () => {
    expect(daysBetween('2026-08-26', '2026-08-26')).toBe(0);
  });
  it('counts across a leap year correctly', () => {
    expect(daysBetween('2028-02-27', '2028-03-01')).toBe(3);
  });
  it('makes the start date Day 1', () => {
    expect(dayNumber('2026-08-26', '2026-08-26')).toBe(1);
  });
  it('makes a full 75-day run end on Day 75', () => {
    expect(dayNumber('2026-08-26', addDays('2026-08-26', 74))).toBe(75);
  });
});

describe('datesBetween', () => {
  it('is inclusive at both ends', () => {
    expect(datesBetween('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ]);
  });
  it('returns empty when the range is inverted', () => {
    expect(datesBetween('2026-09-02', '2026-08-30')).toEqual([]);
  });
});

describe('isEditable', () => {
  const beforeNoon = new Date('2026-08-26T06:29:00Z'); // 11:59 IST on the 26th
  const atNoon     = new Date('2026-08-26T06:30:00Z'); // 12:00 IST on the 26th

  it('always allows today', () => {
    expect(isEditable('2026-08-26', beforeNoon)).toBe(true);
    expect(isEditable('2026-08-26', atNoon)).toBe(true);
  });

  it('allows yesterday before noon', () => {
    expect(isEditable('2026-08-25', beforeNoon)).toBe(true);
  });

  it('rejects yesterday from noon onward', () => {
    expect(isEditable('2026-08-25', atNoon)).toBe(false);
  });

  it('rejects the day before yesterday even before noon', () => {
    expect(isEditable('2026-08-24', beforeNoon)).toBe(false);
  });

  it('rejects future dates', () => {
    expect(isEditable('2026-08-27', beforeNoon)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dates.test.ts`
Expected: FAIL — cannot resolve `../src/lib/dates`.

- [ ] **Step 3: Implement `src/lib/dates.ts`**

```ts
const TZ = 'Asia/Kolkata';
export const LOCK_HOUR_MINUTES = 720; // 12:00

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Parse a YYYY-MM-DD calendar date into a UTC-anchored epoch. Calendar
 *  arithmetic only — UTC has no DST, so day addition is always exact. */
function toEpoch(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromEpoch(ms: number): string {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** The current calendar date in Asia/Kolkata. en-CA formats as YYYY-MM-DD. */
export function todayIST(now: Date): string {
  return dateFmt.format(now);
}

/** Minutes elapsed since IST midnight. 0 at midnight, 720 at noon. */
export function istMinutes(now: Date): number {
  const [h, m] = timeFmt.format(now).split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function addDays(date: string, n: number): string {
  return fromEpoch(toEpoch(date) + n * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toEpoch(to) - toEpoch(from)) / DAY_MS);
}

/** The start date is Day 1. */
export function dayNumber(startDate: string, date: string): number {
  return daysBetween(startDate, date) + 1;
}

/** Inclusive at both ends. Empty if the range is inverted. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = toEpoch(to);
  for (let t = toEpoch(from); t <= end; t += DAY_MS) out.push(fromEpoch(t));
  return out;
}

/** Today is always editable. Yesterday is editable until 12:00 IST. */
export function isEditable(date: string, now: Date): boolean {
  const today = todayIST(now);
  if (date === today) return true;
  if (date === addDays(today, -1)) return istMinutes(now) < LOCK_HOUR_MINUTES;
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dates.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts tests/dates.test.ts
git commit -m "feat: pure IST calendar math with lock-window rules"
```

---

## Task 3: Pure grading rules

**Files:**
- Create: `src/lib/rules.ts`
- Test: `tests/rules.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type GoalSnapshot = { id: string; title: string; kind: GoalKind; target: number; unit: string | null }`
  - `type GoalKind = 'check' | 'count' | 'duration'`
  - `type ProgressMap = Record<string, number>`
  - `type DayGrade = { state: 'passed' | 'failed'; missedGoalIds: string[] }`
  - `isGoalComplete(goal: GoalSnapshot, value: number): boolean`
  - `gradeDay(snapshot: GoalSnapshot[], progress: ProgressMap): DayGrade`
  - `STRIKE_LIMIT: number` (3)
  - `isRunOver(strikeCount: number): boolean`
  - `displayStrikes(strikeCount: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/rules.test.ts
import { describe, it, expect } from 'vitest';
import {
  isGoalComplete, gradeDay, isRunOver, displayStrikes,
  STRIKE_LIMIT, type GoalSnapshot,
} from '../src/lib/rules';

const check = (id: string): GoalSnapshot =>
  ({ id, title: 'Read', kind: 'check', target: 1, unit: null });
const count = (id: string, target: number): GoalSnapshot =>
  ({ id, title: 'Water', kind: 'count', target, unit: 'glasses' });
const duration = (id: string, target: number): GoalSnapshot =>
  ({ id, title: 'Workout', kind: 'duration', target, unit: 'min' });

describe('isGoalComplete', () => {
  it('completes a checkbox at 1', () => {
    expect(isGoalComplete(check('a'), 0)).toBe(false);
    expect(isGoalComplete(check('a'), 1)).toBe(true);
  });
  it('completes a counter only at or above target', () => {
    expect(isGoalComplete(count('a', 4), 3)).toBe(false);
    expect(isGoalComplete(count('a', 4), 4)).toBe(true);
    expect(isGoalComplete(count('a', 4), 9)).toBe(true);
  });
  it('completes a duration only at or above target', () => {
    expect(isGoalComplete(duration('a', 45), 44)).toBe(false);
    expect(isGoalComplete(duration('a', 45), 45)).toBe(true);
  });
});

describe('gradeDay', () => {
  it('passes when every goal is met', () => {
    const snap = [check('a'), count('b', 4)];
    expect(gradeDay(snap, { a: 1, b: 4 })).toEqual({ state: 'passed', missedGoalIds: [] });
  });

  it('produces one missed goal id per incomplete goal', () => {
    const snap = [check('a'), count('b', 4), duration('c', 45)];
    const grade = gradeDay(snap, { a: 1, b: 2 });
    expect(grade.state).toBe('failed');
    expect(grade.missedGoalIds).toEqual(['b', 'c']);
  });

  it('treats a goal with no progress entry as zero', () => {
    expect(gradeDay([check('a')], {})).toEqual({ state: 'failed', missedGoalIds: ['a'] });
  });

  it('passes an empty snapshot rather than failing it', () => {
    expect(gradeDay([], {})).toEqual({ state: 'passed', missedGoalIds: [] });
  });

  it('reports every miss when a single day exceeds the strike limit', () => {
    const snap = [check('a'), check('b'), check('c'), check('d')];
    const grade = gradeDay(snap, {});
    // Four strikes from one day. The ledger keeps all four; nothing is clamped here.
    expect(grade.missedGoalIds).toHaveLength(4);
    expect(grade.missedGoalIds.length).toBeGreaterThan(STRIKE_LIMIT);
  });
});

describe('run termination', () => {
  it('is not over below the limit', () => {
    expect(isRunOver(0)).toBe(false);
    expect(isRunOver(2)).toBe(false);
  });
  it('is over at the limit', () => {
    expect(isRunOver(3)).toBe(true);
  });
  it('is over past the limit', () => {
    expect(isRunOver(7)).toBe(true);
  });
  it('clamps only the display, never the count', () => {
    expect(displayStrikes(1)).toBe(1);
    expect(displayStrikes(3)).toBe(3);
    expect(displayStrikes(7)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rules.test.ts`
Expected: FAIL — cannot resolve `../src/lib/rules`.

- [ ] **Step 3: Implement `src/lib/rules.ts`**

```ts
export type GoalKind = 'check' | 'count' | 'duration';

export type GoalSnapshot = {
  id: string;
  title: string;
  kind: GoalKind;
  target: number;
  unit: string | null;
};

export type ProgressMap = Record<string, number>;

export type DayGrade = {
  state: 'passed' | 'failed';
  missedGoalIds: string[];
};

export const STRIKE_LIMIT = 3;

/** All three kinds grade identically. Only the UI differs. */
export function isGoalComplete(goal: GoalSnapshot, value: number): boolean {
  return value >= goal.target;
}

/** One entry in missedGoalIds becomes one strike. This function never
 *  clamps: a day with four misses reports four. */
export function gradeDay(snapshot: GoalSnapshot[], progress: ProgressMap): DayGrade {
  const missedGoalIds = snapshot
    .filter((g) => !isGoalComplete(g, progress[g.id] ?? 0))
    .map((g) => g.id);
  return {
    state: missedGoalIds.length > 0 ? 'failed' : 'passed',
    missedGoalIds,
  };
}

export function isRunOver(strikeCount: number): boolean {
  return strikeCount >= STRIKE_LIMIT;
}

/** Display only. The ledger keeps the true count. */
export function displayStrikes(strikeCount: number): number {
  return Math.min(strikeCount, STRIKE_LIMIT);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/rules.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.ts tests/rules.test.ts
git commit -m "feat: pure grading rules with uncapped strike reporting"
```

---

## Task 4: D1 schema

**Files:**
- Create: `migrations/0001_init.sql`
- Modify: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: the tables listed in spec §3, available to every later task

- [ ] **Step 1: Create `migrations/0001_init.sql`**

Copy the DDL from spec §3 verbatim. All eleven tables plus the partial unique index:

```sql
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

CREATE INDEX days_run_date   ON days(run_id, date);
CREATE INDEX strikes_run     ON strikes(run_id);
CREATE INDEX food_log_user_d ON food_log(user_id, date);
```

- [ ] **Step 2: Write a test that the migration applies and the active-run guard holds**

Replace `tests/smoke.test.ts` with:

```ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.MIGRATIONS);
});

it('serves the api health route', async () => {
  const res = await SELF.fetch('https://example.com/api/health');
  expect(res.status).toBe(200);
});

it('creates every table', async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all<{ name: string }>();
  const names = results.map((r) => r.name);
  for (const t of [
    'users', 'sessions', 'runs', 'goals', 'days', 'progress',
    'food_items', 'food_log', 'strikes', 'photos', 'push_subs',
  ]) {
    expect(names).toContain(t);
  }
});

it('permits only one active run per user', async () => {
  await env.DB.prepare(
    "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u1','A','#EA580C','h','s',1)",
  ).run();
  const insertRun = (id: string, status: string) =>
    env.DB.prepare(
      'INSERT INTO runs (id,user_id,variant,attempt_no,start_date,status) VALUES (?,?,?,?,?,?)',
    ).bind(id, 'u1', 'hard', 1, '2026-08-26', status).run();

  await insertRun('r1', 'active');
  await expect(insertRun('r2', 'active')).rejects.toThrow();
  // a failed run alongside an active one is fine
  await expect(insertRun('r3', 'failed')).resolves.toBeDefined();
});
```

- [ ] **Step 3: Wire migrations into the test environment**

Add to `vitest.config.ts` inside `poolOptions.workers`:

```ts
        miniflare: {
          d1Databases: ['DB'],
          bindings: {},
        },
```

and create `tests/env.d.ts`:

```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    MIGRATIONS: D1Migration[];
  }
}
```

Then add to `vitest.config.ts` above the `defineWorkersConfig` call:

```ts
import { readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
const migrations = await readD1Migrations('./migrations');
```

and inside `miniflare`, add `bindings: { MIGRATIONS: migrations }`.

- [ ] **Step 4: Apply locally and run the tests**

Run: `npm run migrate:local && npm test`
Expected: PASS. The duplicate-active-run insert must reject.

- [ ] **Step 5: Commit**

```bash
git add migrations tests/smoke.test.ts tests/env.d.ts vitest.config.ts
git commit -m "feat: d1 schema with single-active-run constraint"
```

---

## Task 5: PIN hashing

**Files:**
- Create: `src/lib/password.ts`, `src/lib/ids.ts`
- Test: `tests/password.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `hashPin(pin: string, existingSalt?: string): Promise<{ hash: string; salt: string }>`
  - `verifyPin(pin: string, hash: string, salt: string): Promise<boolean>`
  - `sha256(input: string): Promise<string>`
  - `newId(): string`
  - `newToken(): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/password.test.ts
import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, sha256 } from '../src/lib/password';
import { newId, newToken } from '../src/lib/ids';

describe('hashPin / verifyPin', () => {
  it('verifies the correct pin', async () => {
    const { hash, salt } = await hashPin('1234');
    expect(await verifyPin('1234', hash, salt)).toBe(true);
  });

  it('rejects the wrong pin', async () => {
    const { hash, salt } = await hashPin('1234');
    expect(await verifyPin('1235', hash, salt)).toBe(false);
  });

  it('produces a different hash for the same pin with a new salt', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('reproduces the same hash when given the same salt', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234', a.salt);
    expect(b.hash).toBe(a.hash);
  });
});

describe('sha256', () => {
  it('is stable and hex-encoded', async () => {
    const a = await sha256('token');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256('token')).toBe(a);
  });
});

describe('ids', () => {
  it('generates unique ids and tokens', () => {
    expect(newId()).not.toBe(newId());
    expect(newToken()).not.toBe(newToken());
    expect(newToken().length).toBeGreaterThanOrEqual(43);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/password.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/ids.ts`**

```ts
export function newId(): string {
  return crypto.randomUUID();
}

/** 32 bytes of randomness, base64url. Used as the raw session cookie value. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64url(bytes);
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
```

- [ ] **Step 4: Implement `src/lib/password.ts`**

```ts
import { b64url, fromB64url } from './ids';

const ITERATIONS = 100_000;

export async function hashPin(
  pin: string,
  existingSalt?: string,
): Promise<{ hash: string; salt: string }> {
  const salt = existingSalt
    ? fromB64url(existingSalt)
    : crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key, 256,
  );

  return { hash: b64url(new Uint8Array(bits)), salt: b64url(salt) };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await hashPin(pin, salt);
  return timingSafeEqual(candidate.hash, hash);
}

/** Constant-time string compare. Length is not secret here (fixed-width hash). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/password.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/password.ts src/lib/ids.ts tests/password.test.ts
git commit -m "feat: pbkdf2 pin hashing and id generation"
```

---

## Task 6: Presets and the DB layer

**Files:**
- Create: `src/presets.ts`, `src/db/users.ts`, `src/db/runs.ts`, `src/db/goals.ts`, `src/db/days.ts`, `src/db/strikes.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: `GoalKind`, `GoalSnapshot` from `src/lib/rules`; `newId` from `src/lib/ids`
- Produces:
  - `PRESETS: Record<'hard'|'soft', { goals: PresetGoal[]; banned: string[] }>`
  - `type PresetGoal = { title: string; kind: GoalKind; target: number; unit: string | null }`
  - `getUserByName`, `listUsersPublic`, `getUser`, `recordPinFailure`, `clearPinFailures`
  - `createSession`, `getSessionUser`, `deleteSession`
  - `getActiveRun`, `createRun`, `failRun`, `listRuns`
  - `listActiveGoals`, `createGoal`, `updateGoal`, `archiveGoal`
  - `getDay`, `createDay`, `listDays`, `listUnlockedDays`, `lockDay`, `updateSnapshot`, `getProgress`, `setProgress`
  - `countStrikes`, `addStrikes`, `listStrikes`

- [ ] **Step 1: Create `src/presets.ts`**

```ts
import type { GoalKind } from './lib/rules';

export type PresetGoal = {
  title: string;
  kind: GoalKind;
  target: number;
  unit: string | null;
};

export const PRESETS: Record<'hard' | 'soft', { goals: PresetGoal[]; banned: string[] }> = {
  hard: {
    goals: [
      { title: '45 min workout',    kind: 'duration', target: 45, unit: 'min' },
      { title: 'Outdoor workout',   kind: 'duration', target: 45, unit: 'min' },
      { title: 'Drink water',       kind: 'count',    target: 16, unit: 'glasses' },
      { title: 'Read 10 pages',     kind: 'count',    target: 10, unit: 'pages' },
      { title: 'Follow the diet',   kind: 'check',    target: 1,  unit: null },
      { title: 'Progress photo',    kind: 'check',    target: 1,  unit: null },
    ],
    banned: ['Alcohol', 'Sugar / sweets', 'Fried snacks', 'Soft drinks', 'Processed snacks'],
  },
  soft: {
    goals: [
      { title: '45 min movement',   kind: 'duration', target: 45, unit: 'min' },
      { title: 'Drink water',       kind: 'count',    target: 12, unit: 'glasses' },
      { title: 'Read 10 pages',     kind: 'count',    target: 10, unit: 'pages' },
      { title: 'Follow the diet',   kind: 'check',    target: 1,  unit: null },
    ],
    banned: ['Alcohol', 'Sugar / sweets', 'Fried snacks'],
  },
};
```

- [ ] **Step 2: Create `src/db/users.ts`**

```ts
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
```

- [ ] **Step 3: Create `src/db/runs.ts`**

```ts
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

export function listRuns(db: D1Database, userId: string): Promise<D1Result<RunRow>> {
  return db.prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY attempt_no DESC')
    .bind(userId).all<RunRow>();
}
```

- [ ] **Step 4: Create `src/db/goals.ts`**

```ts
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

export async function createGoal(
  db: D1Database, userId: string,
  g: { title: string; kind: GoalKind; target: number; unit: string | null; sortOrder: number },
): Promise<GoalRow> {
  const id = newId();
  await db.prepare(
    `INSERT INTO goals (id,user_id,title,kind,target,unit,sort_order,active,created_at)
     VALUES (?,?,?,?,?,?,?,1,?)`,
  ).bind(id, userId, g.title, g.kind, g.target, g.unit, g.sortOrder, Date.now()).run();
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
```

- [ ] **Step 5: Create `src/db/days.ts`**

```ts
import { newId } from '../lib/ids';
import type { GoalSnapshot, ProgressMap } from '../lib/rules';

export type DayRow = {
  id: string; run_id: string; date: string; day_number: number;
  state: 'open' | 'passed' | 'failed';
  goals_snapshot: string; locked_at: number | null;
};

export function getDay(db: D1Database, runId: string, date: string): Promise<DayRow | null> {
  return db.prepare('SELECT * FROM days WHERE run_id = ? AND date = ?')
    .bind(runId, date).first<DayRow>();
}

export async function createDay(
  db: D1Database, runId: string, date: string,
  dayNumber: number, snapshot: GoalSnapshot[],
): Promise<DayRow> {
  const id = newId();
  await db.prepare(
    `INSERT INTO days (id,run_id,date,day_number,state,goals_snapshot)
     VALUES (?,?,?,?,'open',?)`,
  ).bind(id, runId, date, dayNumber, JSON.stringify(snapshot)).run();
  return {
    id, run_id: runId, date, day_number: dayNumber,
    state: 'open', goals_snapshot: JSON.stringify(snapshot), locked_at: null,
  };
}

export async function listUnlockedDays(
  db: D1Database, runId: string, upToDate: string,
): Promise<DayRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM days WHERE run_id = ? AND locked_at IS NULL AND date <= ? ORDER BY date',
  ).bind(runId, upToDate).all<DayRow>();
  return results;
}

export async function listDays(db: D1Database, runId: string): Promise<DayRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM days WHERE run_id = ? ORDER BY date',
  ).bind(runId).all<DayRow>();
  return results;
}

/** The idempotency guard lives in the WHERE clause: a second lock is a no-op. */
export async function lockDay(
  db: D1Database, dayId: string, state: 'passed' | 'failed', at: number,
): Promise<boolean> {
  const res = await db.prepare(
    'UPDATE days SET state = ?, locked_at = ? WHERE id = ? AND locked_at IS NULL',
  ).bind(state, at, dayId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Only ever called for the current, unlocked day. */
export async function updateSnapshot(
  db: D1Database, dayId: string, snapshot: GoalSnapshot[],
): Promise<void> {
  await db.prepare('UPDATE days SET goals_snapshot = ? WHERE id = ? AND locked_at IS NULL')
    .bind(JSON.stringify(snapshot), dayId).run();
}

export async function getProgress(db: D1Database, dayId: string): Promise<ProgressMap> {
  const { results } = await db.prepare(
    'SELECT goal_id, value FROM progress WHERE day_id = ?',
  ).bind(dayId).all<{ goal_id: string; value: number }>();
  const map: ProgressMap = {};
  for (const r of results) map[r.goal_id] = r.value;
  return map;
}

export async function setProgress(
  db: D1Database, dayId: string, goalId: string, value: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO progress (day_id, goal_id, value) VALUES (?,?,?)
     ON CONFLICT (day_id, goal_id) DO UPDATE SET value = excluded.value`,
  ).bind(dayId, goalId, value).run();
}
```

- [ ] **Step 6: Create `src/db/strikes.ts`**

```ts
import { newId } from '../lib/ids';

export type StrikeRow = {
  id: string; run_id: string; date: string;
  reason: 'missed_goal' | 'banned_food'; ref_id: string | null; at: number;
};

export async function countStrikes(db: D1Database, runId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM strikes WHERE run_id = ?')
    .bind(runId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Appends one row per entry. Never clamps — see the global constraints. */
export async function addStrikes(
  db: D1Database, runId: string, date: string,
  reason: 'missed_goal' | 'banned_food', refIds: (string | null)[], at: number,
): Promise<void> {
  if (refIds.length === 0) return;
  const stmt = db.prepare(
    'INSERT INTO strikes (id,run_id,date,reason,ref_id,at) VALUES (?,?,?,?,?,?)',
  );
  await db.batch(refIds.map((ref) => stmt.bind(newId(), runId, date, reason, ref, at)));
}

export async function listStrikes(db: D1Database, runId: string): Promise<StrikeRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM strikes WHERE run_id = ? ORDER BY at',
  ).bind(runId).all<StrikeRow>();
  return results;
}
```

- [ ] **Step 7: Write the DB layer test**

```ts
// tests/db.test.ts
import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRun, getActiveRun, failRun } from '../src/db/runs';
import { createGoal, listActiveGoals, archiveGoal, toSnapshot } from '../src/db/goals';
import { createDay, getProgress, setProgress, lockDay } from '../src/db/days';
import { addStrikes, countStrikes } from '../src/db/strikes';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM users'),
  ]);
  await env.DB.prepare(
    "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u1','A','#EA580C','h','s',1)",
  ).run();
});

it('creates and retrieves an active run, and stops retrieving it once failed', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  expect((await getActiveRun(env.DB, 'u1'))?.id).toBe(run.id);
  await failRun(env.DB, run.id, '2026-08-30');
  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
});

it('archives a goal without removing it from listings of the past', async () => {
  const g = await createGoal(env.DB, 'u1',
    { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(1);
  await archiveGoal(env.DB, 'u1', g.id);
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(0);
});

it('upserts progress', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const goals = toSnapshot([await createGoal(env.DB, 'u1',
    { title: 'Water', kind: 'count', target: 4, unit: 'glasses', sortOrder: 0 })]);
  const day = await createDay(env.DB, run.id, '2026-08-26', 1, goals);

  await setProgress(env.DB, day.id, goals[0]!.id, 2);
  await setProgress(env.DB, day.id, goals[0]!.id, 3);
  expect(await getProgress(env.DB, day.id)).toEqual({ [goals[0]!.id]: 3 });
});

it('locks a day exactly once', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const day = await createDay(env.DB, run.id, '2026-08-26', 1, []);
  expect(await lockDay(env.DB, day.id, 'passed', 111)).toBe(true);
  expect(await lockDay(env.DB, day.id, 'failed', 222)).toBe(false);
});

it('appends every strike without clamping', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  await addStrikes(env.DB, run.id, '2026-08-26', 'missed_goal', ['g1','g2','g3','g4'], 1);
  expect(await countStrikes(env.DB, run.id)).toBe(4);
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/presets.ts src/db tests/db.test.ts
git commit -m "feat: presets and d1 query layer"
```

---

## Task 7: The grading service

The heart of the application. Everything before this was groundwork.

**Files:**
- Create: `src/services/grading.ts`
- Test: `tests/grading.test.ts`

**Interfaces:**
- Consumes: everything from `src/lib/dates`, `src/lib/rules`, `src/db/*`
- Produces:
  - `catchUpGrading(db: D1Database, userId: string, now: Date): Promise<{ runFailed: boolean }>`
  - `lastGradableDate(now: Date): string`
  - `ensureDay(db, run, date, userId, now): Promise<DayRow>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/grading.test.ts
import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { catchUpGrading, lastGradableDate, ensureDay } from '../src/services/grading';
import { createRun, getActiveRun } from '../src/db/runs';
import { createGoal, listActiveGoals, toSnapshot } from '../src/db/goals';
import { listDays, setProgress, getDay } from '../src/db/days';
import { countStrikes, listStrikes } from '../src/db/strikes';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM users'),
  ]);
  await env.DB.prepare(
    "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u1','A','#EA580C','h','s',1)",
  ).run();
});

const afterNoon  = (d: string) => new Date(`${d}T07:00:00Z`); // 12:30 IST
const beforeNoon = (d: string) => new Date(`${d}T05:00:00Z`); // 10:30 IST

async function oneCheckGoal() {
  await createGoal(env.DB, 'u1', { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
  return toSnapshot(await listActiveGoals(env.DB, 'u1'));
}

it('does not grade yesterday before noon', () => {
  // 10:30 IST on the 27th: only the 25th and earlier are gradable
  expect(lastGradableDate(beforeNoon('2026-08-27'))).toBe('2026-08-25');
});

it('grades yesterday from noon onward', () => {
  expect(lastGradableDate(afterNoon('2026-08-27'))).toBe('2026-08-26');
});

it('materialises days the user never opened and strikes them', async () => {
  await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-24', 1);

  // Nobody opened the app. Now it is 12:30 IST on the 27th.
  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));

  const days = await listDays(env.DB, run.id);
  const dates = days.map((d) => d.date);
  expect(dates).toContain('2026-08-24');
  expect(dates).toContain('2026-08-25');
  expect(dates).toContain('2026-08-26');

  // 24th and 25th graded and failed; run dead before it could grade the 26th
  expect(await countStrikes(env.DB, run.id)).toBeGreaterThanOrEqual(2);
  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
});

it('passes a day where every goal was met and adds no strike', async () => {
  const snap = await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const day = await ensureDay(env.DB, run, '2026-08-26', 'u1', afterNoon('2026-08-26'));
  await setProgress(env.DB, day.id, snap[0]!.id, 1);

  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));

  expect((await getDay(env.DB, run.id, '2026-08-26'))?.state).toBe('passed');
  expect(await countStrikes(env.DB, run.id)).toBe(0);
});

it('is idempotent — a second pass changes nothing', async () => {
  await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);

  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));
  const first = await countStrikes(env.DB, run.id);
  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));
  expect(await countStrikes(env.DB, run.id)).toBe(first);
});

it('records every strike when one day exceeds the limit, and fails the run', async () => {
  for (const t of ['A', 'B', 'C', 'D']) {
    await createGoal(env.DB, 'u1', { title: t, kind: 'check', target: 1, unit: null, sortOrder: 0 });
  }
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  await ensureDay(env.DB, run, '2026-08-26', 'u1', afterNoon('2026-08-26'));

  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));

  expect(await countStrikes(env.DB, run.id)).toBe(4); // ledger keeps all four
  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
  expect((await listStrikes(env.DB, run.id)).every((s) => s.reason === 'missed_goal')).toBe(true);
});

it('grades a locked day against its snapshot, not against later goal edits', async () => {
  const snap = await oneCheckGoal();
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  const day = await ensureDay(env.DB, run, '2026-08-26', 'u1', afterNoon('2026-08-26'));
  await setProgress(env.DB, day.id, snap[0]!.id, 1);
  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));
  expect((await getDay(env.DB, run.id, '2026-08-26'))?.state).toBe('passed');

  // Adding a goal afterwards must not retroactively fail that day
  await createGoal(env.DB, 'u1', { title: 'New', kind: 'check', target: 1, unit: null, sortOrder: 1 });
  await catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27'));
  expect((await getDay(env.DB, run.id, '2026-08-26'))?.state).toBe('passed');
  expect(await countStrikes(env.DB, run.id)).toBe(0);
});

it('does nothing when there is no active run', async () => {
  await expect(catchUpGrading(env.DB, 'u1', afterNoon('2026-08-27')))
    .resolves.toEqual({ runFailed: false });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/grading.test.ts`
Expected: FAIL — cannot resolve `../src/services/grading`.

- [ ] **Step 3: Implement `src/services/grading.ts`**

```ts
import {
  todayIST, istMinutes, addDays, dayNumber, datesBetween, LOCK_HOUR_MINUTES,
} from '../lib/dates';
import { gradeDay, isRunOver, type GoalSnapshot } from '../lib/rules';
import { getActiveRun, failRun, type RunRow } from '../db/runs';
import { listActiveGoals, toSnapshot } from '../db/goals';
import {
  getDay, createDay, listUnlockedDays, lockDay, getProgress, type DayRow,
} from '../db/days';
import { addStrikes, countStrikes } from '../db/strikes';

/** The most recent date whose lock window has closed.
 *  Day D locks at 12:00 IST on D+1, so before noon only D-2 is gradable. */
export function lastGradableDate(now: Date): string {
  const today = todayIST(now);
  return istMinutes(now) >= LOCK_HOUR_MINUTES ? addDays(today, -1) : addDays(today, -2);
}

/** Fetch a day row, creating it from the user's current goals if absent. */
export async function ensureDay(
  db: D1Database, run: RunRow, date: string, userId: string, _now: Date,
): Promise<DayRow> {
  const existing = await getDay(db, run.id, date);
  if (existing) return existing;
  const snapshot: GoalSnapshot[] = toSnapshot(await listActiveGoals(db, userId));
  return createDay(db, run.id, date, dayNumber(run.start_date, date), snapshot);
}

/**
 * Materialise every missing day up to yesterday, then grade every unlocked
 * day whose lock window has closed. Safe to call concurrently and repeatedly:
 * `lockDay` only acts on rows where `locked_at IS NULL`.
 */
export async function catchUpGrading(
  db: D1Database, userId: string, now: Date,
): Promise<{ runFailed: boolean }> {
  const run = await getActiveRun(db, userId);
  if (!run) return { runFailed: false };

  const today = todayIST(now);
  if (run.start_date > today) return { runFailed: false };

  // 1. Materialise gaps. Up to yesterday — today's row is created on demand
  //    so that a same-day goal edit is reflected in its snapshot.
  const yesterday = addDays(today, -1);
  if (run.start_date <= yesterday) {
    for (const date of datesBetween(run.start_date, yesterday)) {
      await ensureDay(db, run, date, userId, now);
    }
  }

  // 2. Grade everything whose window has closed, oldest first.
  const cutoff = lastGradableDate(now);
  if (cutoff < run.start_date) return { runFailed: false };

  const at = now.getTime();
  for (const day of await listUnlockedDays(db, run.id, cutoff)) {
    const snapshot = JSON.parse(day.goals_snapshot) as GoalSnapshot[];
    const progress = await getProgress(db, day.id);
    const grade = gradeDay(snapshot, progress);

    // Claim the day first. If another pass already locked it, skip entirely
    // so its strikes are never appended twice.
    const claimed = await lockDay(db, day.id, grade.state, at);
    if (!claimed) continue;

    if (grade.missedGoalIds.length > 0) {
      await addStrikes(db, run.id, day.date, 'missed_goal', grade.missedGoalIds, at);
    }

    if (isRunOver(await countStrikes(db, run.id))) {
      await failRun(db, run.id, today);
      return { runFailed: true };
    }
  }

  return { runFailed: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/grading.test.ts`
Expected: PASS, all eight cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/grading.ts tests/grading.test.ts
git commit -m "feat: grading service with day materialisation and idempotent locking"
```

---

## Task 8: Auth API

**Files:**
- Create: `src/api/auth.ts`, `src/api/middleware.ts`, `src/api/router.ts`
- Modify: `src/worker.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `hashPin`, `verifyPin`, `sha256`, `newToken`, `src/db/users`, `catchUpGrading`
- Produces:
  - Hono app at `src/api/router.ts` default export
  - `type Vars = { user: PublicUser }` — Hono context variable set by `requireAuth`
  - `requireAuth` middleware
  - `COOKIE_NAME = 'sid'`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auth.test.ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u1', 'Utkarsh', '#EA580C', hash, salt, Date.now()).run();
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

it('lists users without leaking pin material', async () => {
  const res = await SELF.fetch('https://example.com/api/auth/users');
  expect(res.status).toBe(200);
  const users = await res.json<{ id: string; name: string; color: string }[]>();
  expect(users).toHaveLength(1);
  expect(JSON.stringify(users)).not.toContain('pin');
});

it('logs in with the right pin and sets an HttpOnly cookie', async () => {
  const res = await post('/api/auth/login', { userId: 'u1', pin: '1234' });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie') ?? '';
  expect(cookie).toContain('sid=');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
});

it('rejects the wrong pin', async () => {
  const res = await post('/api/auth/login', { userId: 'u1', pin: '9999' });
  expect(res.status).toBe(401);
});

it('locks the account after five failures', async () => {
  for (let i = 0; i < 5; i++) await post('/api/auth/login', { userId: 'u1', pin: '9999' });
  // even the correct pin is refused while locked
  const res = await post('/api/auth/login', { userId: 'u1', pin: '1234' });
  expect(res.status).toBe(429);
});

it('clears the failure counter on a successful login', async () => {
  await post('/api/auth/login', { userId: 'u1', pin: '9999' });
  await post('/api/auth/login', { userId: 'u1', pin: '1234' });
  const row = await env.DB.prepare('SELECT failed_pins FROM users WHERE id = ?')
    .bind('u1').first<{ failed_pins: number }>();
  expect(row?.failed_pins).toBe(0);
});

it('refuses protected routes without a session', async () => {
  const res = await SELF.fetch('https://example.com/api/me');
  expect(res.status).toBe(401);
});

it('accepts protected routes with a session', async () => {
  const login = await post('/api/auth/login', { userId: 'u1', pin: '1234' });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  const res = await SELF.fetch('https://example.com/api/me', { headers: { cookie } });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Implement `src/api/middleware.ts`**

```ts
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { sha256 } from '../lib/password';
import { getSessionUser, type PublicUser } from '../db/users';
import { catchUpGrading } from '../services/grading';
import type { Env } from '../worker';

export const COOKIE_NAME = 'sid';

export type Vars = { user: PublicUser };
export type App = { Bindings: Env; Variables: Vars };

export async function requireAuth(c: Context<App>, next: Next) {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw) return c.json({ error: 'unauthorised' }, 401);

  const user = await getSessionUser(c.env.DB, await sha256(raw), Date.now());
  if (!user) return c.json({ error: 'unauthorised' }, 401);

  c.set('user', user);

  // Backstop for a missed cron. Idempotent — see services/grading.ts.
  await catchUpGrading(c.env.DB, user.id, new Date());

  await next();
}
```

- [ ] **Step 4: Implement `src/api/auth.ts`**

```ts
import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyPin, sha256 } from '../lib/password';
import { newToken } from '../lib/ids';
import {
  listUsersPublic, getUser, recordPinFailure, clearPinFailures,
  createSession, deleteSession,
} from '../db/users';
import { COOKIE_NAME, type App } from './middleware';

const SESSION_MS = 90 * 24 * 60 * 60 * 1000;

const loginSchema = z.object({
  userId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/),
});

export const auth = new Hono<App>();

auth.get('/users', async (c) => {
  const { results } = await listUsersPublic(c.env.DB);
  return c.json(results);
});

auth.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const { userId, pin } = parsed.data;
  const now = Date.now();
  const user = await getUser(c.env.DB, userId);

  // Same response for unknown user and wrong pin.
  if (!user) return c.json({ error: 'invalid credentials' }, 401);
  if (user.locked_until && user.locked_until > now) {
    return c.json({ error: 'too many attempts' }, 429);
  }

  if (!(await verifyPin(pin, user.pin_hash, user.pin_salt))) {
    await recordPinFailure(c.env.DB, user.id, now);
    return c.json({ error: 'invalid credentials' }, 401);
  }

  await clearPinFailures(c.env.DB, user.id);

  const token = newToken();
  await createSession(c.env.DB, await sha256(token), user.id, now + SESSION_MS);

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true, secure: true, sameSite: 'Lax',
    path: '/', maxAge: SESSION_MS / 1000,
  });

  return c.json({ id: user.id, name: user.name, color: user.color });
});

auth.post('/logout', async (c) => {
  const raw = getCookie(c, COOKIE_NAME);
  if (raw) await deleteSession(c.env.DB, await sha256(raw));
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Implement `src/api/router.ts`**

```ts
import { Hono } from 'hono';
import { auth } from './auth';
import { requireAuth, type App } from './middleware';

export const api = new Hono<App>().basePath('/api');

api.get('/health', (c) => c.json({ ok: true }));
api.route('/auth', auth);

api.use('/me/*', requireAuth);
api.use('/me', requireAuth);

// Placeholder so the auth test can assert a 200 behind the guard.
// Replaced with the real handler in Task 9.
api.get('/me', (c) => c.json({ user: c.get('user') }));

export default api;
```

- [ ] **Step 6: Wire the router into `src/worker.ts`**

```ts
import api from './api/router';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return api.fetch(req, env, ctx);
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledController, _env: Env): Promise<void> {
    // wired up in Task 12
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS, all seven cases.

- [ ] **Step 8: Commit**

```bash
git add src/api tests/auth.test.ts src/worker.ts
git commit -m "feat: pin auth with session cookies and lockout"
```

---

## Task 9: Onboarding and reset

**Files:**
- Create: `src/services/onboarding.ts`, `src/api/me.ts`
- Modify: `src/api/router.ts`
- Test: `tests/onboarding.test.ts`

**Interfaces:**
- Consumes: `PRESETS`, `createRun`, `createGoal`, `listRuns`, `catchUpGrading`
- Produces:
  - `startRun(db, userId, variant, startDate, seed: boolean): Promise<RunRow>`
  - `POST /api/onboarding`, `POST /api/run/reset`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/onboarding.test.ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { listActiveGoals } from '../src/db/goals';
import { getActiveRun } from '../src/db/runs';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM food_items'),
    env.DB.prepare('DELETE FROM goals'), env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u1', 'Utkarsh', '#EA580C', hash, salt, Date.now()).run();

  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

const post = (path: string, body: unknown) =>
  SELF.fetch(`https://example.com${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

it('seeds hard preset goals and banned foods, and creates attempt 1', async () => {
  const res = await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  expect(res.status).toBe(200);

  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(6);
  const run = await getActiveRun(env.DB, 'u1');
  expect(run?.variant).toBe('hard');
  expect(run?.attempt_no).toBe(1);

  const banned = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM food_items WHERE user_id='u1' AND status='banned'",
  ).first<{ n: number }>();
  expect(banned?.n).toBe(5);
});

it('seeds fewer goals for soft', async () => {
  await post('/api/onboarding', { variant: 'soft', startDate: '2026-08-26' });
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(4);
});

it('refuses a second onboarding while a run is active', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  const res = await post('/api/onboarding', { variant: 'soft', startDate: '2026-08-26' });
  expect(res.status).toBe(409);
});

it('refuses reset while the run is still active', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  const res = await post('/api/run/reset', {});
  expect(res.status).toBe(409);
});

it('starts attempt 2 after a failure, keeping goals and archiving the old run', async () => {
  await post('/api/onboarding', { variant: 'hard', startDate: '2026-08-26' });
  const first = await getActiveRun(env.DB, 'u1');
  await env.DB.prepare("UPDATE runs SET status='failed', ended_date='2026-08-30' WHERE id=?")
    .bind(first!.id).run();

  const res = await post('/api/run/reset', {});
  expect(res.status).toBe(200);

  const second = await getActiveRun(env.DB, 'u1');
  expect(second?.attempt_no).toBe(2);
  expect(second?.id).not.toBe(first!.id);
  expect(await listActiveGoals(env.DB, 'u1')).toHaveLength(6); // carried over, not reseeded

  const old = await env.DB.prepare('SELECT status FROM runs WHERE id = ?')
    .bind(first!.id).first<{ status: string }>();
  expect(old?.status).toBe('failed'); // archived, not deleted
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/onboarding.test.ts`
Expected: FAIL — 404 on `/api/onboarding`.

- [ ] **Step 3: Implement `src/services/onboarding.ts`**

```ts
import { PRESETS } from '../presets';
import { newId } from '../lib/ids';
import { createRun, listRuns, type RunRow } from '../db/runs';
import { createGoal } from '../db/goals';

/**
 * Create a new run. `seed` is true only for a user's very first run —
 * a reset carries the existing goals and food lists forward untouched.
 */
export async function startRun(
  db: D1Database, userId: string,
  variant: 'hard' | 'soft', startDate: string, seed: boolean,
): Promise<RunRow> {
  const { results } = await listRuns(db, userId);
  const attemptNo = results.length + 1;

  if (seed) {
    const preset = PRESETS[variant];
    let order = 0;
    for (const g of preset.goals) {
      await createGoal(db, userId, {
        title: g.title, kind: g.kind, target: g.target, unit: g.unit, sortOrder: order++,
      });
    }
    const stmt = db.prepare(
      "INSERT INTO food_items (id,user_id,name,status) VALUES (?,?,?,'banned')",
    );
    await db.batch(preset.banned.map((name) => stmt.bind(newId(), userId, name)));
  }

  return createRun(db, userId, variant, startDate, attemptNo);
}
```

- [ ] **Step 4: Implement `src/api/me.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { todayIST } from '../lib/dates';
import { displayStrikes, STRIKE_LIMIT, type GoalSnapshot } from '../lib/rules';
import { getActiveRun, listRuns } from '../db/runs';
import { listActiveGoals, toSnapshot } from '../db/goals';
import { getProgress } from '../db/days';
import { countStrikes } from '../db/strikes';
import { ensureDay } from '../services/grading';
import { startRun } from '../services/onboarding';
import type { App } from './middleware';

export const me = new Hono<App>();

const onboardingSchema = z.object({
  variant: z.enum(['hard', 'soft']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

me.post('/onboarding', async (c) => {
  const user = c.get('user');
  const parsed = onboardingSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  if (await getActiveRun(c.env.DB, user.id)) {
    return c.json({ error: 'a run is already active' }, 409);
  }

  const run = await startRun(
    c.env.DB, user.id, parsed.data.variant, parsed.data.startDate, true,
  );
  return c.json(run);
});

me.post('/run/reset', async (c) => {
  const user = c.get('user');
  if (await getActiveRun(c.env.DB, user.id)) {
    return c.json({ error: 'run is still active' }, 409);
  }

  const { results } = await listRuns(c.env.DB, user.id);
  const previous = results[0];
  if (!previous) return c.json({ error: 'no previous run' }, 409);

  // seed = false: goals and food lists carry over untouched.
  const run = await startRun(
    c.env.DB, user.id, previous.variant, todayIST(new Date()), false,
  );
  return c.json(run);
});

me.get('/', async (c) => {
  const user = c.get('user');
  const now = new Date();
  const run = await getActiveRun(c.env.DB, user.id);

  if (!run) {
    const { results } = await listRuns(c.env.DB, user.id);
    const previous = results[0] ?? null;
    return c.json({
      user,
      run: null,
      needsOnboarding: previous === null,
      lastRun: previous,
    });
  }

  const today = todayIST(now);
  const day = await ensureDay(c.env.DB, run, today, user.id, now);
  const snapshot = JSON.parse(day.goals_snapshot) as GoalSnapshot[];
  const progress = await getProgress(c.env.DB, day.id);
  const strikes = await countStrikes(c.env.DB, run.id);

  return c.json({
    user,
    run,
    needsOnboarding: false,
    today: {
      date: day.date,
      dayNumber: day.day_number,
      state: day.state,
      goals: snapshot,
      progress,
    },
    strikes: { used: displayStrikes(strikes), limit: STRIKE_LIMIT },
  });
});
```

- [ ] **Step 5: Rewire `src/api/router.ts`**

Replace the placeholder `/me` handler:

```ts
import { Hono } from 'hono';
import { auth } from './auth';
import { me } from './me';
import { requireAuth, type App } from './middleware';

export const api = new Hono<App>().basePath('/api');

api.get('/health', (c) => c.json({ ok: true }));
api.route('/auth', auth);

api.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/health') return next();
  return requireAuth(c, next);
});

api.route('/me', me);          // GET /api/me
api.route('/', me);            // POST /api/onboarding, POST /api/run/reset

export default api;
```

Note: `me.get('/')` mounted at `/me` answers `GET /api/me`; the same router mounted at `/` answers `POST /api/onboarding` and `POST /api/run/reset` exactly as the spec's API table specifies.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/onboarding.test.ts tests/auth.test.ts`
Expected: PASS. Both files.

- [ ] **Step 7: Commit**

```bash
git add src/services/onboarding.ts src/api/me.ts src/api/router.ts tests/onboarding.test.ts
git commit -m "feat: onboarding with presets and post-failure reset"
```

---

## Task 10: Goals CRUD API

**Files:**
- Create: `src/api/goals.ts`
- Modify: `src/api/router.ts`
- Test: `tests/goals-api.test.ts`

**Interfaces:**
- Consumes: `src/db/goals`, `getActiveRun`, `getDay`, `updateSnapshot`, `todayIST`
- Produces: `GET/POST /api/goals`, `PATCH/DELETE /api/goals/:id`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/goals-api.test.ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { getActiveRun } from '../src/db/runs';
import { getDay } from '../src/db/days';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM food_items'),
    env.DB.prepare('DELETE FROM goals'), env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u1', 'Utkarsh', '#EA580C', hash, salt, Date.now()).run();
  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

const req = (path: string, method: string, body?: unknown) =>
  SELF.fetch(`https://example.com${path}`, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function onboard() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'soft', startDate: today });
  return today;
}

it('lists the seeded goals', async () => {
  await onboard();
  const res = await req('/api/goals', 'GET');
  expect(res.status).toBe(200);
  expect(await res.json<unknown[]>()).toHaveLength(4);
});

it('adds a goal and reflects it in today\'s snapshot', async () => {
  const today = await onboard();
  await req('/api/me', 'GET'); // materialise today
  const res = await req('/api/goals', 'POST',
    { title: 'Meditate', kind: 'duration', target: 10, unit: 'min' });
  expect(res.status).toBe(200);

  const run = await getActiveRun(env.DB, 'u1');
  const day = await getDay(env.DB, run!.id, today);
  const snap = JSON.parse(day!.goals_snapshot) as { title: string }[];
  expect(snap.map((g) => g.title)).toContain('Meditate');
});

it('rejects an invalid kind', async () => {
  await onboard();
  const res = await req('/api/goals', 'POST',
    { title: 'X', kind: 'weekly', target: 1, unit: null });
  expect(res.status).toBe(400);
});

it('rejects a target below 1', async () => {
  await onboard();
  const res = await req('/api/goals', 'POST',
    { title: 'X', kind: 'count', target: 0, unit: 'x' });
  expect(res.status).toBe(400);
});

it('archives a goal and drops it from today\'s snapshot', async () => {
  const today = await onboard();
  await req('/api/me', 'GET');
  const goals = await (await req('/api/goals', 'GET')).json<{ id: string; title: string }[]>();
  const victim = goals[0]!;

  expect((await req(`/api/goals/${victim.id}`, 'DELETE')).status).toBe(200);

  const run = await getActiveRun(env.DB, 'u1');
  const day = await getDay(env.DB, run!.id, today);
  const snap = JSON.parse(day!.goals_snapshot) as { id: string }[];
  expect(snap.map((g) => g.id)).not.toContain(victim.id);
});

it('refuses to touch another user\'s goal', async () => {
  await onboard();
  await env.DB.prepare(
    "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u2','B','#fff','h','s',1)",
  ).run();
  await env.DB.prepare(
    `INSERT INTO goals (id,user_id,title,kind,target,unit,sort_order,active,created_at)
     VALUES ('gx','u2','Theirs','check',1,NULL,0,1,1)`,
  ).run();

  await req('/api/goals/gx', 'DELETE');
  const row = await env.DB.prepare('SELECT active FROM goals WHERE id = ?')
    .bind('gx').first<{ active: number }>();
  expect(row?.active).toBe(1); // untouched
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/goals-api.test.ts`
Expected: FAIL — 404 on `/api/goals`.

- [ ] **Step 3: Implement `src/api/goals.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { todayIST } from '../lib/dates';
import { listActiveGoals, createGoal, updateGoal, archiveGoal, toSnapshot } from '../db/goals';
import { getActiveRun } from '../db/runs';
import { getDay, updateSnapshot } from '../db/days';
import type { App } from './middleware';

export const goals = new Hono<App>();

const goalSchema = z.object({
  title: z.string().trim().min(1).max(60),
  kind: z.enum(['check', 'count', 'duration']),
  target: z.number().int().min(1).max(10_000),
  unit: z.string().trim().max(20).nullable(),
});

/** Goal edits apply from today forward. Today's snapshot is rewritten;
 *  locked days are untouched because updateSnapshot ignores locked rows. */
async function refreshTodaySnapshot(db: D1Database, userId: string): Promise<void> {
  const run = await getActiveRun(db, userId);
  if (!run) return;
  const day = await getDay(db, run.id, todayIST(new Date()));
  if (!day || day.locked_at !== null) return;
  await updateSnapshot(db, day.id, toSnapshot(await listActiveGoals(db, userId)));
}

goals.get('/', async (c) => {
  return c.json(await listActiveGoals(c.env.DB, c.get('user').id));
});

goals.post('/', async (c) => {
  const parsed = goalSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const userId = c.get('user').id;
  const existing = await listActiveGoals(c.env.DB, userId);
  const goal = await createGoal(c.env.DB, userId, {
    ...parsed.data, sortOrder: existing.length,
  });
  await refreshTodaySnapshot(c.env.DB, userId);
  return c.json(goal);
});

goals.patch('/:id', async (c) => {
  const parsed = goalSchema.extend({ sortOrder: z.number().int().min(0) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const userId = c.get('user').id;
  // The user_id in the WHERE clause is the ownership check.
  await updateGoal(c.env.DB, userId, c.req.param('id'), parsed.data);
  await refreshTodaySnapshot(c.env.DB, userId);
  return c.json({ ok: true });
});

goals.delete('/:id', async (c) => {
  const userId = c.get('user').id;
  await archiveGoal(c.env.DB, userId, c.req.param('id'));
  await refreshTodaySnapshot(c.env.DB, userId);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount it in `src/api/router.ts`**

Add the import and the route, after the `me` mounts:

```ts
import { goals } from './goals';
// ...
api.route('/goals', goals);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/goals-api.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 6: Commit**

```bash
git add src/api/goals.ts src/api/router.ts tests/goals-api.test.ts
git commit -m "feat: goals crud with forward-only snapshot updates"
```

---

## Task 11: Day progress API

**Files:**
- Create: `src/api/days.ts`
- Modify: `src/api/router.ts`
- Test: `tests/days-api.test.ts`

**Interfaces:**
- Consumes: `isEditable`, `ensureDay`, `getDay`, `setProgress`, `getProgress`
- Produces: `GET /api/days/:date`, `PUT /api/days/:date/goals/:goalId`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/days-api.test.ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { todayIST, addDays } from '../src/lib/dates';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
let today = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM food_items'),
    env.DB.prepare('DELETE FROM goals'), env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u1', 'Utkarsh', '#EA580C', hash, salt, Date.now()).run();
  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  today = todayIST(new Date());
  await SELF.fetch('https://example.com/api/onboarding', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ variant: 'soft', startDate: today }),
  });
});

const req = (path: string, method: string, body?: unknown) =>
  SELF.fetch(`https://example.com${path}`, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function firstGoalId(): Promise<string> {
  const goals = await (await req('/api/goals', 'GET')).json<{ id: string }[]>();
  return goals[0]!.id;
}

it('returns today with its goals and zeroed progress', async () => {
  const res = await req(`/api/days/${today}`, 'GET');
  expect(res.status).toBe(200);
  const day = await res.json<{ dayNumber: number; goals: unknown[]; editable: boolean }>();
  expect(day.dayNumber).toBe(1);
  expect(day.goals).toHaveLength(4);
  expect(day.editable).toBe(true);
});

it('records progress and reads it back', async () => {
  const gid = await firstGoalId();
  expect((await req(`/api/days/${today}/goals/${gid}`, 'PUT', { value: 30 })).status).toBe(200);

  const day = await (await req(`/api/days/${today}`, 'GET'))
    .json<{ progress: Record<string, number> }>();
  expect(day.progress[gid]).toBe(30);
});

it('rejects a negative value', async () => {
  const gid = await firstGoalId();
  const res = await req(`/api/days/${today}/goals/${gid}`, 'PUT', { value: -1 });
  expect(res.status).toBe(400);
});

it('rejects a malformed date', async () => {
  expect((await req('/api/days/26-08-2026', 'GET')).status).toBe(400);
});

it('refuses writes to a date outside the edit window', async () => {
  const old = addDays(today, -5);
  const gid = await firstGoalId();
  const res = await req(`/api/days/${old}/goals/${gid}`, 'PUT', { value: 1 });
  expect(res.status).toBe(409);
});

it('refuses writes to a future date', async () => {
  const gid = await firstGoalId();
  const res = await req(`/api/days/${addDays(today, 1)}/goals/${gid}`, 'PUT', { value: 1 });
  expect(res.status).toBe(409);
});

it('refuses a goal id that is not in that day\'s snapshot', async () => {
  const res = await req(`/api/days/${today}/goals/not-a-real-goal`, 'PUT', { value: 1 });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/days-api.test.ts`
Expected: FAIL — 404 on `/api/days/...`.

- [ ] **Step 3: Implement `src/api/days.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { isEditable, todayIST } from '../lib/dates';
import type { GoalSnapshot } from '../lib/rules';
import { getActiveRun } from '../db/runs';
import { getDay, getProgress, setProgress } from '../db/days';
import { ensureDay } from '../services/grading';
import type { App } from './middleware';

export const days = new Hono<App>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const valueSchema = z.object({ value: z.number().int().min(0).max(100_000) });

days.get('/:date', async (c) => {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);

  const user = c.get('user');
  const now = new Date();
  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 404);
  if (date < run.start_date || date > todayIST(now)) {
    return c.json({ error: 'outside the run' }, 404);
  }

  const day = await ensureDay(c.env.DB, run, date, user.id, now);
  return c.json({
    date: day.date,
    dayNumber: day.day_number,
    state: day.state,
    editable: day.locked_at === null && isEditable(date, now),
    goals: JSON.parse(day.goals_snapshot) as GoalSnapshot[],
    progress: await getProgress(c.env.DB, day.id),
  });
});

days.put('/:date/goals/:goalId', async (c) => {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);

  const parsed = valueSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const user = c.get('user');
  const now = new Date();

  if (!isEditable(date, now)) return c.json({ error: 'day is locked' }, 409);

  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 404);
  if (date < run.start_date) return c.json({ error: 'outside the run' }, 409);

  const day = await getDay(c.env.DB, run.id, date);
  if (!day) return c.json({ error: 'day not found' }, 404);
  if (day.locked_at !== null) return c.json({ error: 'day is locked' }, 409);

  // The snapshot is the authority on which goals this day has.
  const snapshot = JSON.parse(day.goals_snapshot) as GoalSnapshot[];
  const goalId = c.req.param('goalId');
  if (!snapshot.some((g) => g.id === goalId)) {
    return c.json({ error: 'goal not in this day' }, 404);
  }

  await setProgress(c.env.DB, day.id, goalId, parsed.data.value);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount it in `src/api/router.ts`**

```ts
import { days } from './days';
// ...
api.route('/days', days);
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, every file.

- [ ] **Step 6: Commit**

```bash
git add src/api/days.ts src/api/router.ts tests/days-api.test.ts
git commit -m "feat: day progress api honouring the edit window"
```

---

## Task 12: Cron handler

**Files:**
- Modify: `src/worker.ts`
- Create: `src/services/cron.ts`
- Test: `tests/cron.test.ts`

**Interfaces:**
- Consumes: `catchUpGrading`
- Produces: `runDailyLock(db: D1Database, now: Date): Promise<{ graded: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cron.test.ts
import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { runDailyLock } from '../src/services/cron';
import { createRun, getActiveRun } from '../src/db/runs';
import { createGoal } from '../src/db/goals';
import { countStrikes } from '../src/db/strikes';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM users'),
  ]);
  for (const [id, name] of [['u1', 'A'], ['u2', 'B']] as const) {
    await env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, name, '#EA580C', 'h', 's', 1).run();
  }
});

it('grades every user with an active run, not just one', async () => {
  for (const uid of ['u1', 'u2']) {
    await createGoal(env.DB, uid, { title: 'Read', kind: 'check', target: 1, unit: null, sortOrder: 0 });
    await createRun(env.DB, uid, 'soft', '2026-08-26', 1);
  }

  // 12:30 IST on the 27th — the 26th is now gradable and nobody logged anything.
  const res = await runDailyLock(env.DB, new Date('2026-08-27T07:00:00Z'));
  expect(res.graded).toBe(2);

  for (const uid of ['u1', 'u2']) {
    const run = await env.DB.prepare('SELECT id FROM runs WHERE user_id = ?')
      .bind(uid).first<{ id: string }>();
    expect(await countStrikes(env.DB, run!.id)).toBe(1);
  }
});

it('is a no-op when nobody has an active run', async () => {
  const res = await runDailyLock(env.DB, new Date('2026-08-27T07:00:00Z'));
  expect(res.graded).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cron.test.ts`
Expected: FAIL — cannot resolve `../src/services/cron`.

- [ ] **Step 3: Implement `src/services/cron.ts`**

```ts
import { catchUpGrading } from './grading';

/**
 * Grade every user with an active run. Called from the 12:00 IST cron.
 * Each user is graded independently: one user's failure must not stop the rest.
 */
export async function runDailyLock(
  db: D1Database, now: Date,
): Promise<{ graded: number }> {
  const { results } = await db.prepare(
    "SELECT DISTINCT user_id FROM runs WHERE status = 'active'",
  ).all<{ user_id: string }>();

  let graded = 0;
  for (const { user_id } of results) {
    try {
      await catchUpGrading(db, user_id, now);
      graded++;
    } catch (err) {
      console.error('grading failed', user_id, err);
    }
  }
  return { graded };
}
```

- [ ] **Step 4: Wire it into `src/worker.ts`**

Replace the `scheduled` stub:

```ts
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    // "30 6 * * *" is 12:00 IST — the daily lock.
    // "30 15 * * *" is 21:00 IST — the nudge push, added in Phase 5.
    if (event.cron === '30 6 * * *') {
      ctx.waitUntil(runDailyLock(env.DB, now).then(({ graded }) => {
        console.log(`daily lock graded ${graded} users`);
      }));
    }
  },
```

and add the import at the top: `import { runDailyLock } from './services/cron';`

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/cron.ts src/worker.ts tests/cron.test.ts
git commit -m "feat: daily lock cron grading all active runs"
```

---

## Task 13: Frontend shell and theme

**Files:**
- Create: `vite.config.ts`, `web/index.html`, `web/main.tsx`, `web/theme.css`, `web/api.ts`, `web/components/BottomNav.tsx`, `web/components/StrikePips.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: the API routes from Tasks 8–11
- Produces:
  - `api` object in `web/api.ts` with typed methods used by every screen
  - `<BottomNav />`, `<StrikePips used limit />`

- [ ] **Step 1: Add frontend dependencies**

Run:

```bash
npm i react react-dom react-router-dom lucide-react
npm i -D @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react @types/react-dom
```

- [ ] **Step 2: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
```

- [ ] **Step 3: Create `web/index.html`**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>75 Hard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@300;400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `web/theme.css`**

```css
@import 'tailwindcss';

@theme {
  --color-background: #0f172a;
  --color-card: #192134;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-foreground: #f8fafc;
  --color-muted: #94a3b8;
  --color-primary: #ea580c;
  --color-success: #22c55e;
  --color-destructive: #ef4444;

  --font-display: 'Barlow Condensed', system-ui, sans-serif;
  --font-body: 'Barlow', system-ui, sans-serif;
}

html, body, #root {
  min-height: 100dvh;
}

body {
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-body);
  font-size: 16px;           /* never below 16px: avoids iOS input auto-zoom */
  -webkit-tap-highlight-color: transparent;
}

.tabular { font-variant-numeric: tabular-nums; }

.display {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Every interactive element clears the 44px minimum. */
button, a[role='button'], [role='checkbox'] {
  min-height: 44px;
  min-width: 44px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Create `web/api.ts`**

```ts
export type PublicUser = { id: string; name: string; color: string };
export type GoalKind = 'check' | 'count' | 'duration';
export type Goal = {
  id: string; title: string; kind: GoalKind; target: number; unit: string | null;
};
export type DayView = {
  date: string; dayNumber: number; state: 'open' | 'passed' | 'failed';
  editable: boolean; goals: Goal[]; progress: Record<string, number>;
};
export type Run = {
  id: string; variant: 'hard' | 'soft'; attempt_no: number;
  start_date: string; status: 'active' | 'failed' | 'done'; ended_date: string | null;
};
export type MeView = {
  user: PublicUser;
  run: Run | null;
  needsOnboarding: boolean;
  lastRun?: Run | null;
  today?: Omit<DayView, 'editable'>;
  strikes?: { used: number; limit: number };
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json<{ error?: string }>().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json<T>();
}

export const api = {
  users: () => call<PublicUser[]>('/api/auth/users'),
  login: (userId: string, pin: string) =>
    call<PublicUser>('/api/auth/login', { method: 'POST', body: JSON.stringify({ userId, pin }) }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  me: () => call<MeView>('/api/me'),
  onboard: (variant: 'hard' | 'soft', startDate: string) =>
    call<Run>('/api/onboarding', { method: 'POST', body: JSON.stringify({ variant, startDate }) }),
  reset: () => call<Run>('/api/run/reset', { method: 'POST', body: '{}' }),

  day: (date: string) => call<DayView>(`/api/days/${date}`),
  setProgress: (date: string, goalId: string, value: number) =>
    call<{ ok: true }>(`/api/days/${date}/goals/${goalId}`, {
      method: 'PUT', body: JSON.stringify({ value }),
    }),

  goals: () => call<Goal[]>('/api/goals'),
  addGoal: (g: Omit<Goal, 'id'>) =>
    call<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(g) }),
  deleteGoal: (id: string) =>
    call<{ ok: true }>(`/api/goals/${id}`, { method: 'DELETE' }),
};
```

- [ ] **Step 6: Create `web/components/StrikePips.tsx`**

```tsx
export function StrikePips({ used, limit }: { used: number; limit: number }) {
  return (
    // The count label is why this is never colour-only.
    <div className="flex items-center gap-2" aria-label={`${used} of ${limit} strikes used`}>
      <span className="display text-xs text-[var(--color-muted)]">Strikes</span>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: limit }, (_, i) => (
          <span
            key={i}
            className="h-1.5 w-5 rounded-sm"
            style={{ background: i < used ? 'var(--color-primary)' : '#2A3550' }}
          />
        ))}
      </div>
      <span className="tabular text-xs text-[var(--color-muted)]">{used}/{limit}</span>
    </div>
  );
}
```

- [ ] **Step 7: Create `web/components/BottomNav.tsx`**

Food and Family are Phase 2 and 3; they render as disabled until then, rather than being absent and reshuffling the layout later.

```tsx
import { NavLink } from 'react-router-dom';
import { CalendarCheck, Utensils, Users, User } from 'lucide-react';

const items = [
  { to: '/today',  label: 'Today',  Icon: CalendarCheck, enabled: true },
  { to: '/food',   label: 'Food',   Icon: Utensils,      enabled: false },
  { to: '/family', label: 'Family', Icon: Users,         enabled: false },
  { to: '/me',     label: 'Me',     Icon: User,          enabled: true },
];

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 flex justify-around border-t
                 border-[var(--color-border)] bg-[var(--color-background)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map(({ to, label, Icon, enabled }) =>
        enabled ? (
          <NavLink
            key={to} to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2 display text-[10px] ${
                isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted)]'
              }`
            }
          >
            <Icon size={20} aria-hidden />
            {label}
          </NavLink>
        ) : (
          <span
            key={to} aria-disabled="true"
            className="flex flex-1 flex-col items-center gap-1 py-2 display text-[10px]
                       text-[var(--color-muted)] opacity-40"
          >
            <Icon size={20} aria-hidden />
            {label}
          </span>
        ),
      )}
    </nav>
  );
}
```

- [ ] **Step 8: Create `web/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './theme.css';
import { Today } from './screens/Today';
import { Login } from './screens/Login';
import { Onboarding } from './screens/Onboarding';
import { GoalsEditor } from './screens/GoalsEditor';
import { RunOver } from './screens/RunOver';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/today" element={<Today />} />
        <Route path="/me" element={<GoalsEditor />} />
        <Route path="/run-over" element={<RunOver />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 9: Add the build script check**

Run: `npm run build`
Expected: fails, because the screen modules do not exist yet. That is the next four tasks. Do not commit a broken build — go straight to Task 14 and commit at the end of Task 17.

- [ ] **Step 10: Stage the work without committing**

```bash
git add vite.config.ts web package.json
```

---

## Task 14: Login screen

**Files:**
- Create: `web/screens/Login.tsx`

**Interfaces:**
- Consumes: `api.users`, `api.login`
- Produces: `<Login />`

- [ ] **Step 1: Implement `web/screens/Login.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete } from 'lucide-react';
import { api, ApiError, type PublicUser } from '../api';

export function Login() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [picked, setPicked] = useState<PublicUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { api.users().then(setUsers).catch(() => setError('Could not load users.')); }, []);

  useEffect(() => {
    if (pin.length !== 4 || !picked || busy) return;
    setBusy(true);
    api.login(picked.id, pin)
      .then(() => navigate('/today', { replace: true }))
      .catch((e: ApiError) => {
        setError(e.status === 429
          ? 'Too many attempts. Locked for 15 minutes.'
          : 'Wrong PIN.');
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin, picked, busy, navigate]);

  if (!picked) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="display mb-4 text-3xl">Who's training?</h1>
        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        {users.map((u) => (
          <button
            key={u.id}
            onClick={() => { setPicked(u); setError(''); }}
            className="flex items-center gap-3 rounded-xl border border-[var(--color-border)]
                       bg-[var(--color-card)] p-4 text-left transition-colors duration-200"
          >
            <span className="h-6 w-6 rounded-lg" style={{ background: u.color }} aria-hidden />
            <span className="text-lg">{u.name}</span>
          </button>
        ))}
      </main>
    );
  }

  const press = (d: string) => setPin((p) => (p.length < 4 ? p + d : p));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <button
        onClick={() => { setPicked(null); setPin(''); setError(''); }}
        className="display self-start text-xs text-[var(--color-muted)]"
      >
        ← Not {picked.name}
      </button>

      <h1 className="display text-3xl">Enter PIN</h1>

      <div className="flex gap-3" aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-4 w-4 rounded-full border border-[var(--color-border)]"
            style={{ background: i < pin.length ? 'var(--color-primary)' : 'transparent' }}
          />
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {['1','2','3','4','5','6','7','8','9'].map((d) => (
          <button key={d} onClick={() => press(d)}
            className="tabular rounded-xl bg-[var(--color-card)] py-4 text-2xl">{d}</button>
        ))}
        <span />
        <button onClick={() => press('0')}
          className="tabular rounded-xl bg-[var(--color-card)] py-4 text-2xl">0</button>
        <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete last digit"
          className="flex items-center justify-center rounded-xl bg-[var(--color-card)]">
          <Delete size={22} aria-hidden />
        </button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Stage**

```bash
git add web/screens/Login.tsx
```

---

## Task 15: Onboarding screen

**Files:**
- Create: `web/screens/Onboarding.tsx`

**Interfaces:**
- Consumes: `api.onboard`
- Produces: `<Onboarding />`

- [ ] **Step 1: Implement `web/screens/Onboarding.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function Onboarding() {
  const [variant, setVariant] = useState<'hard' | 'soft'>('hard');
  const [startDate, setStartDate] = useState(todayIST());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function start() {
    setBusy(true);
    setError('');
    try {
      await api.onboard(variant, startDate);
      navigate('/today', { replace: true });
    } catch {
      setError('Could not start the run. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <h1 className="display mt-8 text-3xl">Pick your challenge</h1>

      {([
        ['hard', '75 Hard', 'Two 45-minute workouts, one outdoors. 16 glasses of water. 10 pages. Diet. Daily photo.'],
        ['soft', '75 Soft', 'One 45-minute session. 12 glasses of water. 10 pages. Diet.'],
      ] as const).map(([v, title, blurb]) => (
        <button
          key={v}
          onClick={() => setVariant(v)}
          aria-pressed={variant === v}
          className="rounded-xl border p-4 text-left transition-colors duration-200"
          style={{
            borderColor: variant === v ? 'var(--color-primary)' : 'var(--color-border)',
            background: 'var(--color-card)',
          }}
        >
          <div className="display text-xl">{title}</div>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{blurb}</p>
        </button>
      ))}

      <label className="flex flex-col gap-2">
        <span className="display text-xs text-[var(--color-muted)]">Start date</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-base"
        />
      </label>

      <p className="text-sm text-[var(--color-muted)]">
        Every goal you miss is a strike. Three strikes and you go back to Day 1.
        You can edit your goals any time — changes apply from today forward.
      </p>

      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}

      <button
        onClick={start}
        disabled={busy}
        className="display mt-auto rounded-xl bg-[var(--color-primary)] py-4 text-lg
                   disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start Day 1'}
      </button>
    </main>
  );
}
```

- [ ] **Step 2: Stage**

```bash
git add web/screens/Onboarding.tsx
```

---

## Task 16: Today screen

**Files:**
- Create: `web/screens/Today.tsx`, `web/components/GoalRow.tsx`, `web/components/CounterSheet.tsx`

**Interfaces:**
- Consumes: `api.me`, `api.day`, `api.setProgress`, `<StrikePips />`, `<BottomNav />`
- Produces: `<Today />`, `<GoalRow />`, `<CounterSheet />`

- [ ] **Step 1: Implement `web/components/CounterSheet.tsx`**

```tsx
import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { Goal } from '../api';

export function CounterSheet({
  goal, initial, onClose, onSave,
}: {
  goal: Goal; initial: number;
  onClose: () => void; onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  const step = goal.kind === 'duration' ? 5 : 1;

  return (
    <div
      role="dialog" aria-modal="true" aria-label={goal.title}
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl border-t border-[var(--color-border)]
                   bg-[var(--color-card)] p-6"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="display text-xl">{goal.title}</h2>
          <button onClick={onClose} aria-label="Close"><X size={22} aria-hidden /></button>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setValue((v) => Math.max(0, v - step))}
            aria-label={`Decrease by ${step}`}
            className="rounded-full bg-[var(--color-background)] p-4"
          >
            <Minus size={24} aria-hidden />
          </button>

          <div className="text-center">
            <div className="tabular display text-5xl">{value}</div>
            <div className="text-sm text-[var(--color-muted)]">
              of {goal.target} {goal.unit ?? ''}
            </div>
          </div>

          <button
            onClick={() => setValue((v) => v + step)}
            aria-label={`Increase by ${step}`}
            className="rounded-full bg-[var(--color-background)] p-4"
          >
            <Plus size={24} aria-hidden />
          </button>
        </div>

        <button
          onClick={() => { onSave(value); onClose(); }}
          className="display mt-6 w-full rounded-xl bg-[var(--color-primary)] py-4 text-lg"
        >
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `web/components/GoalRow.tsx`**

```tsx
import { Check } from 'lucide-react';
import type { Goal } from '../api';

export function GoalRow({
  goal, value, editable, onToggle, onOpenSheet,
}: {
  goal: Goal; value: number; editable: boolean;
  onToggle: () => void; onOpenSheet: () => void;
}) {
  const done = value >= goal.target;
  const isCheck = goal.kind === 'check';

  return (
    <button
      onClick={editable ? (isCheck ? onToggle : onOpenSheet) : undefined}
      disabled={!editable}
      aria-pressed={isCheck ? done : undefined}
      className="mb-2 flex w-full items-center gap-3 rounded-xl border
                 border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left
                 transition-colors duration-200 disabled:opacity-60"
    >
      <span
        className="flex h-6 w-6 flex-none items-center justify-center rounded border"
        style={{
          background: done ? 'var(--color-primary)' : 'transparent',
          borderColor: done ? 'var(--color-primary)' : '#3A4459',
        }}
        aria-hidden
      >
        {done && <Check size={16} strokeWidth={3} />}
      </span>

      <span className="flex-1">{goal.title}</span>

      {!isCheck && (
        <span className="tabular text-sm text-[var(--color-muted)]">
          {value}/{goal.target}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Implement `web/screens/Today.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DayView, type Goal, type MeView } from '../api';
import { GoalRow } from '../components/GoalRow';
import { CounterSheet } from '../components/CounterSheet';
import { StrikePips } from '../components/StrikePips';
import { BottomNav } from '../components/BottomNav';

const istDate = (offsetDays = 0) => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number) as [number, number, number];
  return fmt.format(new Date(Date.UTC(y, m - 1, d + offsetDays, 12)));
};

const istHour = () =>
  Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date()));

export function Today() {
  const [me, setMe] = useState<MeView | null>(null);
  const [date, setDate] = useState(istDate());
  const [day, setDay] = useState<DayView | null>(null);
  const [sheet, setSheet] = useState<Goal | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      if (m.needsOnboarding) return navigate('/onboarding', { replace: true });
      if (!m.run) return navigate('/run-over', { replace: true });
      setDay(await api.day(date));
    } catch {
      navigate('/login', { replace: true });
    }
  }, [date, navigate]);

  useEffect(() => { void load(); }, [load]);

  async function write(goalId: string, value: number) {
    if (!day) return;
    // Optimistic, then reconcile — a grading pass may have ended the run.
    setDay({ ...day, progress: { ...day.progress, [goalId]: value } });
    try {
      await api.setProgress(date, goalId, value);
    } finally {
      await load();
    }
  }

  if (!me?.run || !day) {
    return <main className="grid min-h-dvh place-items-center text-[var(--color-muted)]">Loading…</main>;
  }

  const graceOpen = istHour() < 12;
  const yesterday = istDate(-1);
  const viewingToday = date === istDate();
  const canShowYesterday = graceOpen && yesterday >= me.run.start_date;

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <div className="flex items-start justify-between">
          <div>
            <div className="display text-xs text-[var(--color-muted)]">
              75 {me.run.variant === 'hard' ? 'Hard' : 'Soft'} · {me.user.name}
            </div>
            <div className="display text-5xl">
              Day <span className="tabular text-[var(--color-primary)]">{day.dayNumber}</span>
            </div>
          </div>
          <StrikePips used={me.strikes?.used ?? 0} limit={me.strikes?.limit ?? 3} />
        </div>

        {canShowYesterday && (
          <button
            onClick={() => setDate(viewingToday ? yesterday : istDate())}
            className="display mt-3 w-full rounded-xl border border-[var(--color-primary)]
                       py-3 text-xs text-[var(--color-primary)]"
          >
            {viewingToday ? 'Yesterday — locks at 12:00' : 'Back to today'}
          </button>
        )}

        {!day.editable && (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            This day is locked. {day.state === 'failed' ? 'Goals were missed.' : 'All goals met.'}
          </p>
        )}

        <div className="mt-4">
          {day.goals.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              value={day.progress[g.id] ?? 0}
              editable={day.editable}
              onToggle={() => write(g.id, (day.progress[g.id] ?? 0) >= g.target ? 0 : g.target)}
              onOpenSheet={() => setSheet(g)}
            />
          ))}
        </div>
      </main>

      {sheet && (
        <CounterSheet
          goal={sheet}
          initial={day.progress[sheet.id] ?? 0}
          onClose={() => setSheet(null)}
          onSave={(v) => write(sheet.id, v)}
        />
      )}

      <BottomNav />
    </>
  );
}
```

- [ ] **Step 4: Stage**

```bash
git add web/screens/Today.tsx web/components/GoalRow.tsx web/components/CounterSheet.tsx
```

---

## Task 17: Goals editor and Run Over screens

**Files:**
- Create: `web/screens/GoalsEditor.tsx`, `web/screens/RunOver.tsx`

**Interfaces:**
- Consumes: `api.goals`, `api.addGoal`, `api.deleteGoal`, `api.me`, `api.reset`, `api.logout`
- Produces: `<GoalsEditor />`, `<RunOver />`

- [ ] **Step 1: Implement `web/screens/GoalsEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api, type Goal, type GoalKind } from '../api';
import { BottomNav } from '../components/BottomNav';

const KINDS: { kind: GoalKind; label: string; unit: string | null; target: number }[] = [
  { kind: 'check',    label: 'Done / not done', unit: null,      target: 1 },
  { kind: 'count',    label: 'Counter',         unit: 'times',   target: 1 },
  { kind: 'duration', label: 'Minutes',         unit: 'min',     target: 30 },
];

export function GoalsEditor() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState('');
  const [kindIdx, setKindIdx] = useState(0);
  const [target, setTarget] = useState(1);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => api.goals().then(setGoals).catch(() => navigate('/login', { replace: true }));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function add() {
    const preset = KINDS[kindIdx]!;
    if (!title.trim()) return setError('Give the goal a name.');
    if (target < 1) return setError('Target must be at least 1.');
    setError('');
    await api.addGoal({
      title: title.trim(), kind: preset.kind,
      target: preset.kind === 'check' ? 1 : target, unit: preset.unit,
    });
    setTitle('');
    await load();
  }

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <h1 className="display mt-4 text-3xl">My goals</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Changes apply from today forward. Past days keep the goals they were graded against.
        </p>

        <div className="mt-5">
          {goals.map((g) => (
            <div key={g.id}
              className="mb-2 flex items-center gap-3 rounded-xl border
                         border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <span className="flex-1">{g.title}</span>
              <span className="tabular text-sm text-[var(--color-muted)]">
                {g.kind === 'check' ? '—' : `${g.target} ${g.unit ?? ''}`}
              </span>
              <button
                onClick={async () => { await api.deleteGoal(g.id); await load(); }}
                aria-label={`Remove ${g.title}`}
                className="text-[var(--color-destructive)]"
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-border)] p-4">
          <label className="display block text-xs text-[var(--color-muted)]" htmlFor="goal-title">
            New goal
          </label>
          <input
            id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Meditate"
            className="mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />

          <div className="mt-3 flex gap-2">
            {KINDS.map((k, i) => (
              <button
                key={k.kind} onClick={() => { setKindIdx(i); setTarget(k.target); }}
                aria-pressed={kindIdx === i}
                className="display flex-1 rounded-lg py-2 text-xs"
                style={{
                  background: kindIdx === i ? 'var(--color-primary)' : 'var(--color-background)',
                }}
              >
                {k.label}
              </button>
            ))}
          </div>

          {KINDS[kindIdx]!.kind !== 'check' && (
            <label className="mt-3 flex items-center gap-3">
              <span className="text-sm text-[var(--color-muted)]">Target</span>
              <input
                type="number" min={1} inputMode="numeric" value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                className="tabular w-24 rounded-lg bg-[var(--color-background)] p-2 text-base"
              />
              <span className="text-sm text-[var(--color-muted)]">{KINDS[kindIdx]!.unit}</span>
            </label>
          )}

          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}

          <button onClick={add}
            className="display mt-4 w-full rounded-lg bg-[var(--color-primary)] py-3">
            Add goal
          </button>
        </div>

        <button
          onClick={async () => { await api.logout(); navigate('/login', { replace: true }); }}
          className="display mt-10 w-full rounded-xl border border-[var(--color-destructive)]
                     py-3 text-sm text-[var(--color-destructive)]"
        >
          Log out
        </button>
      </main>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 2: Implement `web/screens/RunOver.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type MeView } from '../api';

export function RunOver() {
  const [me, setMe] = useState<MeView | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.me().then((m) => {
      // An active run means we should not be here.
      if (m.run) return navigate('/today', { replace: true });
      if (m.needsOnboarding) return navigate('/onboarding', { replace: true });
      setMe(m);
    }).catch(() => navigate('/login', { replace: true }));
  }, [navigate]);

  if (!me) return <main className="grid min-h-dvh place-items-center">…</main>;

  const attempt = me.lastRun?.attempt_no ?? 1;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6 text-center">
      <h1 className="display text-5xl text-[var(--color-destructive)]">Run over</h1>
      <p className="text-lg">
        Attempt {attempt} ended after three strikes.
      </p>
      <p className="text-sm text-[var(--color-muted)]">
        Nothing is deleted. Your goals and food lists carry over.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api.reset();
          navigate('/today', { replace: true });
        }}
        className="display mt-4 rounded-xl bg-[var(--color-primary)] py-4 text-lg disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start attempt ' + (attempt + 1)}
      </button>
    </main>
  );
}
```

- [ ] **Step 3: Build and typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed. `dist/client/index.html` exists.

- [ ] **Step 4: Run the whole suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit the whole frontend**

```bash
git add vite.config.ts web package.json package-lock.json
git commit -m "feat: iron-themed spa with login, onboarding, today, goals editor, and reset"
```

---

## Task 18: Seed users and first deploy

**Files:**
- Create: `scripts/seed-users.md`

**Interfaces:**
- Consumes: everything
- Produces: a running deployment

- [ ] **Step 1: Write the seeding runbook**

Create `scripts/seed-users.md`:

````markdown
# Seeding family users

There is no sign-up screen. Users are inserted by hand, once.

Generate a hash for each PIN with a throwaway Node script:

```bash
node --input-type=module -e "
const pin = process.argv[1];
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'}, key, 256);
const b64 = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
console.log(JSON.stringify({ hash: b64(new Uint8Array(bits)), salt: b64(salt) }));
" 1234
```

The iteration count (100000) and encoding must match `src/lib/password.ts` exactly, or
login will fail.

Then insert, one command per person:

```bash
npx wrangler d1 execute 75hard --remote --command \
  "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) \
   VALUES (lower(hex(randomblob(16))),'Utkarsh','#EA580C','<HASH>','<SALT>',unixepoch()*1000)"
```

Suggested colours, one per person, all legible on `#0F172A`:
`#EA580C`, `#22C55E`, `#38BDF8`, `#A78BFA`, `#FBBF24`.
````

- [ ] **Step 2: Create the remote database and apply migrations**

Run:

```bash
npx wrangler d1 create 75hard
```

Paste the returned `database_id` into `wrangler.jsonc`, then:

```bash
npm run migrate:remote
```

- [ ] **Step 3: Deploy**

Run: `npm run deploy`
Expected: a `*.workers.dev` URL.

- [ ] **Step 4: Seed one user and verify the whole loop by hand**

Follow `scripts/seed-users.md` for one user, then in a mobile browser:
1. Load the URL — the login tiles show that user.
2. Wrong PIN four times — each is refused. Fifth locks for 15 minutes.
3. Correct PIN — onboarding appears.
4. Pick 75 Soft, start today — Today shows Day 1 with four goals.
5. Tick a checkbox goal and set a counter — both persist across a reload.
6. Add a goal in Me — it appears on Today immediately.
7. Delete a goal in Me — it disappears from Today immediately.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-users.md wrangler.jsonc
git commit -m "chore: user seeding runbook and production d1 binding"
```

---

## Phase 1 done

At this point a family member can log in, onboard, track a day, edit their goals, get
struck for missed goals at noon the next day, and be reset after three strikes.

**Deferred to later phases, by design:**
- Phase 2 — Food tab (items, diary, slip logging with confirmation)
- Phase 3 — Family tab, run history
- Phase 4 — Progress photos on R2
- Phase 5 — Push notifications and PWA install

The Food and Family nav items render disabled until their phase lands, so the layout does
not shift when they arrive.
