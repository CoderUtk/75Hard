# Phase 3 — Social Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Family tab (fully shared progress across all users), the Me tab as a
real navigation hub (goals, food lists, run history, PIN change), and their backing API
endpoints — completing the phases-1-3 "complete, usable tracker" milestone per the spec's
build order.

**Architecture:** Two new read-only Hono sub-routers (`family`, folded `history` into
`me`) backed by existing `db/runs.ts` and one new `db/family.ts` aggregate query. PIN
change is a new route on the existing `me` router, backed by a new `db/users.ts`
function. On the frontend: `/me` becomes a hub screen linking out to the pre-existing
goals editor (moved from `/me` to `/me/goals`), the pre-existing food list editors
(reused as-is at `/food/allowed` and `/food/banned`, unchanged), and two new screens
(`History`, `PinChange`). `/family` is a new read-only screen. No new tables — this
phase reads `users`, `runs`, `strikes`, `days` as they already exist.

**Tech Stack:** Cloudflare Workers, Hono, D1, Zod, React 19 + Vite + Tailwind, Vitest +
`cloudflare:test` (`SELF.fetch` against a local D1 with migrations applied).

**Spec:** `docs/superpowers/specs/2026-08-26-75hard-family-tracker-design.md` (sections
6 "API", 7 "Screens" — Family and Me — and 12 "Build order", item 3 "Social").

## Global Constraints

- All dates are `Asia/Kolkata`, computed via `src/lib/dates.ts` (`todayIST`, `dayNumber`).
  Never use the device clock or raw UTC arithmetic for a date shown to a user.
- `strikes` is an append-only ledger; "strikes used" is always `COUNT(*)`, never a stored
  counter. Display through `displayStrikes()` (caps the shown number at `STRIKE_LIMIT`
  even though the ledger itself may hold more — see rules.ts's overflow handling).
- Every route lives behind `requireAuth` (already wired globally in
  `src/api/router.ts` for everything except `/api/auth/*` and `/api/health`) — new
  routers need no auth code of their own.
- Every mutating request body is validated with Zod at the route boundary before
  reaching any logic.
- Ownership: any query that touches one user's row must filter by that user's id.
  `db/family.ts` is the one deliberate exception — it reads across all users by design,
  because the Family tab is fully shared per spec decision.
- No emoji as icons — Lucide only, matching the rest of the app.
- Numeric displays (day counts, strike counts) use the existing `tabular` CSS class to
  avoid layout shift, matching every other screen.
- Touch targets and spacing follow the existing screens' conventions (`p-3`/`p-4`
  padding, `mb-2`/`mb-3` gaps) — this codebase does not use an explicit `min-h-[44px]`
  utility anywhere; match what's already there rather than introducing a new standard.
- No end-to-end browser tests. Backend behavior is covered by Vitest integration tests
  against `SELF.fetch` + local D1, following `tests/goals-api.test.ts`'s pattern exactly.
  Frontend screens have no automated tests in this repo (none exist for Food or Today
  either) — verify manually via the dev server, as Phase 2 did.
- Never run `wrangler deploy`, `d1 create`, or any `--remote` command without asking
  first.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/db/family.ts` (new) | One aggregate query: every user, their active run (if any), strike count, and best-ever day number. |
| `src/db/users.ts` (modify) | Add `updatePin` — the one write PIN-change needs. |
| `src/api/family.ts` (new) | `GET /` — shapes `db/family.ts` rows into the Family tab's view model (computes `dayNumber` via `dates.ts`, caps strikes via `displayStrikes`). |
| `src/api/history.ts` (new) | `GET /` — wraps the existing `listRuns` for the current user. |
| `src/api/me.ts` (modify) | Add `POST /pin` — verify current PIN, hash and store the new one. |
| `src/api/router.ts` (modify) | Mount `family` at `/family` and `history` at `/history`. |
| `web/api.ts` (modify) | Add `FamilyMember` type, `family()`, `history()`, `changePin()`. |
| `web/screens/Family.tsx` (new) | Family tab: every member's name, day number, strike pips, attempt, best day. |
| `web/screens/History.tsx` (new) | List of the current user's past runs and outcomes. |
| `web/screens/PinChange.tsx` (new) | Current + new PIN form. |
| `web/screens/Me.tsx` (new) | Me tab hub: links to goals, both food lists, history, PIN change, log out. |
| `web/screens/GoalsEditor.tsx` (modify) | Moves from tab-root to sub-page: add a back button, drop its own Log out button (now owned by the `Me` hub). |
| `web/main.tsx` (modify) | Route `/me` to the new hub, `/me/goals` to `GoalsEditor`, `/me/history` to `History`, `/me/pin` to `PinChange`, `/family` to `Family`. |
| `web/components/BottomNav.tsx` (modify) | Flip Family's `enabled` to `true`. |
| `tests/family-api.test.ts` (new) | Family endpoint shape, an unstarted user, strike display capping. |
| `tests/history-api.test.ts` (new) | History returns own runs only, newest attempt first. |
| `tests/me-pin-api.test.ts` (new) | PIN change: happy path, wrong current PIN, new PIN actually works at login. |

---

## Task 1: Family aggregate query + `GET /api/family`

**Files:**
- Create: `src/db/family.ts`
- Create: `src/api/family.ts`
- Modify: `src/api/router.ts`
- Test: `tests/family-api.test.ts`

**Interfaces:**
- Consumes: `todayIST(now: Date): string` and `dayNumber(startDate: string, date: string): number`
  from `src/lib/dates.ts`; `displayStrikes(strikeCount: number): number` and
  `STRIKE_LIMIT: number` from `src/lib/rules.ts`; `type App` from `src/api/middleware.ts`.
- Produces: `listFamily(db: D1Database): Promise<D1Result<FamilyRow>>` from
  `src/db/family.ts` (used only by `src/api/family.ts`). `GET /api/family` returns
  `FamilyMember[]` (JSON shape defined below) — this is the contract Task 4's frontend
  type must match exactly.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/family-api.test.ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

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
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u2', 'Priya', '#22C55E', hash, salt, Date.now()).run();
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

type FamilyMember = {
  id: string; name: string; color: string;
  variant: 'hard' | 'soft' | null; attemptNo: number | null;
  dayNumber: number | null; strikes: number; strikeLimit: number;
  status: 'active' | null; bestDay: number | null;
};

it('lists every user, including one who has never onboarded', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'hard', startDate: today });

  const res = await req('/api/family', 'GET');
  expect(res.status).toBe(200);
  const members = await res.json<FamilyMember[]>();
  expect(members).toHaveLength(2);

  const u1 = members.find((m) => m.id === 'u1')!;
  expect(u1.status).toBe('active');
  expect(u1.variant).toBe('hard');
  expect(u1.attemptNo).toBe(1);
  expect(u1.dayNumber).toBe(1);
  expect(u1.strikes).toBe(0);
  expect(u1.strikeLimit).toBe(3);

  const u2 = members.find((m) => m.id === 'u2')!;
  expect(u2.status).toBeNull();
  expect(u2.variant).toBeNull();
  expect(u2.dayNumber).toBeNull();
  expect(u2.bestDay).toBeNull();
});

it('caps the displayed strike count at the limit even past overflow', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'hard', startDate: today });
  const { getActiveRun } = await import('../src/db/runs');
  const run = await getActiveRun(env.DB, 'u1');
  // Simulate a grading pass that appended 4 strikes in one go (spec §5.6 overflow).
  await env.DB.batch([1, 2, 3, 4].map((n) =>
    env.DB.prepare('INSERT INTO strikes (id,run_id,date,reason,ref_id,at) VALUES (?,?,?,?,?,?)')
      .bind(`s${n}`, run!.id, today, 'missed_goal', `g${n}`, Date.now())));

  const res = await req('/api/family', 'GET');
  const members = await res.json<FamilyMember[]>();
  const u1 = members.find((m) => m.id === 'u1')!;
  expect(u1.strikes).toBe(3); // displayStrikes caps at STRIKE_LIMIT
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/family-api.test.ts`
Expected: FAIL — `/api/family` does not exist yet (404, or the route mount step throws
if `src/api/family.ts` is imported anywhere prematurely; at this point neither file
exists so the test file itself compiles fine, only the request fails).

- [ ] **Step 3: Write `src/db/family.ts`**

```typescript
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
```

- [ ] **Step 4: Write `src/api/family.ts`**

```typescript
import { Hono } from 'hono';
import { todayIST, dayNumber } from '../lib/dates';
import { displayStrikes, STRIKE_LIMIT } from '../lib/rules';
import { listFamily } from '../db/family';
import type { App } from './middleware';

export const family = new Hono<App>();

family.get('/', async (c) => {
  const now = new Date();
  const { results } = await listFamily(c.env.DB);
  return c.json(results.map((r) => ({
    id: r.id, name: r.name, color: r.color,
    variant: r.variant, attemptNo: r.attempt_no,
    dayNumber: r.run_id && r.start_date ? dayNumber(r.start_date, todayIST(now)) : null,
    strikes: displayStrikes(r.strikes), strikeLimit: STRIKE_LIMIT,
    status: r.status, bestDay: r.best_day,
  })));
});
```

- [ ] **Step 5: Mount the router**

In `src/api/router.ts`, add the import alongside the other route imports:

```typescript
import { family } from './family';
```

And add the mount alongside the other `api.route(...)` calls, after the `days` mount:

```typescript
api.route('/family', family); // GET /api/family
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/family-api.test.ts`
Expected: PASS (both tests)

- [ ] **Step 7: Commit**

```bash
git add src/db/family.ts src/api/family.ts src/api/router.ts tests/family-api.test.ts
git commit -m "feat: GET /api/family — shared progress across all users"
```

---

## Task 2: `GET /api/history`

**Files:**
- Create: `src/api/history.ts`
- Modify: `src/api/router.ts`
- Test: `tests/history-api.test.ts`

**Interfaces:**
- Consumes: `listRuns(db: D1Database, userId: string): Promise<D1Result<RunRow>>` from
  `src/db/runs.ts` (already exists, unchanged). `type App` from `src/api/middleware.ts`.
- Produces: `GET /api/history` returns `RunRow[]` (the exact same shape as the `Run`
  type already defined in `web/api.ts` — no new frontend type needed for this one).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/history-api.test.ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

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
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u2', 'Priya', '#22C55E', hash, salt, Date.now()).run();
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

it('returns the current user\'s runs, newest attempt first', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'hard', startDate: today });
  const { getActiveRun } = await import('../src/db/runs');
  const first = await getActiveRun(env.DB, 'u1');
  await env.DB.prepare("UPDATE runs SET status='failed', ended_date=? WHERE id=?")
    .bind(today, first!.id).run();
  await req('/api/run/reset', 'POST');

  const res = await req('/api/history', 'GET');
  expect(res.status).toBe(200);
  const runs = await res.json<{ attempt_no: number; status: string }[]>();
  expect(runs.map((r) => r.attempt_no)).toEqual([2, 1]);
  expect(runs[1]!.status).toBe('failed');
  expect(runs[0]!.status).toBe('active');
});

it('never returns another user\'s runs', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await env.DB.prepare(
    "INSERT INTO runs (id,user_id,variant,attempt_no,start_date,status) VALUES ('rx','u2','soft',1,?,'active')",
  ).bind(today).run();

  const res = await req('/api/history', 'GET');
  const runs = await res.json<{ id: string }[]>();
  expect(runs.map((r) => r.id)).not.toContain('rx');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/history-api.test.ts`
Expected: FAIL — `/api/history` does not exist yet.

- [ ] **Step 3: Write `src/api/history.ts`**

```typescript
import { Hono } from 'hono';
import { listRuns } from '../db/runs';
import type { App } from './middleware';

export const history = new Hono<App>();

history.get('/', async (c) => {
  const { results } = await listRuns(c.env.DB, c.get('user').id);
  return c.json(results);
});
```

- [ ] **Step 4: Mount the router**

In `src/api/router.ts`, add the import:

```typescript
import { history } from './history';
```

And the mount, after the `family` mount added in Task 1:

```typescript
api.route('/history', history); // GET /api/history
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/history-api.test.ts`
Expected: PASS (both tests)

- [ ] **Step 6: Commit**

```bash
git add src/api/history.ts src/api/router.ts tests/history-api.test.ts
git commit -m "feat: GET /api/history — own past runs and outcomes"
```

---

## Task 3: PIN change — `POST /api/me/pin`

**Files:**
- Modify: `src/db/users.ts`
- Modify: `src/api/me.ts`
- Test: `tests/me-pin-api.test.ts`

**Interfaces:**
- Consumes: `getUser(db, id): Promise<UserRow | null>` (existing, `src/db/users.ts`);
  `verifyPin(pin, hash, salt): Promise<boolean>` and
  `hashPin(pin, existingSalt?): Promise<{hash, salt}>` (existing, `src/lib/password.ts`).
- Produces: `updatePin(db: D1Database, id: string, hash: string, salt: string): Promise<void>`
  in `src/db/users.ts`, used only by `src/api/me.ts`. `POST /api/me/pin` accepts
  `{currentPin: string, newPin: string}` (both `/^\d{4}$/`), returns `{ok: true}` on
  success, `401 {error}` if `currentPin` is wrong, `400` on a malformed body.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/me-pin-api.test.ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

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

it('changes the PIN and the new one works at login', async () => {
  const res = await req('/api/me/pin', 'POST', { currentPin: '1234', newPin: '5678' });
  expect(res.status).toBe(200);

  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '5678' }),
  });
  expect(login.status).toBe(200);

  const oldLogin = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  expect(oldLogin.status).toBe(401);
});

it('refuses with the wrong current PIN and leaves the PIN unchanged', async () => {
  const res = await req('/api/me/pin', 'POST', { currentPin: '0000', newPin: '5678' });
  expect(res.status).toBe(401);

  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  expect(login.status).toBe(200); // original PIN still works
});

it('rejects a non-4-digit new PIN', async () => {
  const res = await req('/api/me/pin', 'POST', { currentPin: '1234', newPin: '12' });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/me-pin-api.test.ts`
Expected: FAIL — `/api/me/pin` does not exist yet (404).

- [ ] **Step 3: Add `updatePin` to `src/db/users.ts`**

Add this function anywhere among the other exports in `src/db/users.ts` (e.g. after
`clearPinFailures`):

```typescript
export async function updatePin(
  db: D1Database, id: string, hash: string, salt: string,
): Promise<void> {
  await db.prepare('UPDATE users SET pin_hash = ?, pin_salt = ? WHERE id = ?')
    .bind(hash, salt, id).run();
}
```

- [ ] **Step 4: Add the route to `src/api/me.ts`**

Add these imports to the top of `src/api/me.ts`, alongside the existing ones:

```typescript
import { verifyPin, hashPin } from '../lib/password';
import { getUser, updatePin } from '../db/users';
```

Add this schema near `onboardingSchema`:

```typescript
const pinChangeSchema = z.object({
  currentPin: z.string().regex(/^\d{4}$/),
  newPin: z.string().regex(/^\d{4}$/),
});
```

Add this route anywhere among the other `me.___(...)` handlers:

```typescript
me.post('/pin', async (c) => {
  const parsed = pinChangeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const sessionUser = c.get('user');
  const user = await getUser(c.env.DB, sessionUser.id);
  if (!user) return c.json({ error: 'unauthorised' }, 401);

  if (!(await verifyPin(parsed.data.currentPin, user.pin_hash, user.pin_salt))) {
    return c.json({ error: 'wrong current pin' }, 401);
  }

  const { hash, salt } = await hashPin(parsed.data.newPin);
  await updatePin(c.env.DB, user.id, hash, salt);
  return c.json({ ok: true });
});
```

This lands at `POST /api/me/pin` because `router.ts` already mounts `me` at
`api.route('/me', me)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/me-pin-api.test.ts`
Expected: PASS (all three)

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npx tsc --noEmit && npm test`
Expected: all pre-existing tests still pass (the 3 known-flaky `onboarding.test.ts`
concurrency cases aside — see that file's "one of two concurrent onboarding requests"
and similar tests, which are pre-existing flakiness unrelated to this work).

- [ ] **Step 7: Commit**

```bash
git add src/db/users.ts src/api/me.ts tests/me-pin-api.test.ts
git commit -m "feat: POST /api/me/pin — change PIN with current-PIN verification"
```

---

## Task 4: Frontend API client additions

**Files:**
- Modify: `web/api.ts`

**Interfaces:**
- Consumes: nothing new — mirrors the exact JSON shapes Tasks 1–3 produced
  (`FamilyMember[]` from `GET /api/family`, `Run[]` from `GET /api/history`, `{ok:true}`
  from `POST /api/me/pin`).
- Produces: `type FamilyMember`, `api.family()`, `api.history()`, `api.changePin()` —
  these are what Tasks 5 and 6's screens import.

- [ ] **Step 1: Add the `FamilyMember` type**

In `web/api.ts`, add this type near the existing `Run` type:

```typescript
export type FamilyMember = {
  id: string; name: string; color: string;
  variant: 'hard' | 'soft' | null; attemptNo: number | null;
  dayNumber: number | null; strikes: number; strikeLimit: number;
  status: 'active' | null; bestDay: number | null;
};
```

- [ ] **Step 2: Add the three methods to the `api` object**

Add these inside the `export const api = { ... }` object, after the existing
`deleteFoodLog` entry:

```typescript
  family: () => call<FamilyMember[]>('/api/family'),
  history: () => call<Run[]>('/api/history'),
  changePin: (currentPin: string, newPin: string) =>
    call<{ ok: true }>('/api/me/pin', {
      method: 'POST', body: JSON.stringify({ currentPin, newPin }),
    }),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. There are no automated frontend tests in this repo (matching
Phase 1 and Phase 2's Food/Today screens) — the client is exercised by Tasks 5 and 6's
screens and verified manually in Task 7.

- [ ] **Step 4: Commit**

```bash
git add web/api.ts
git commit -m "feat: frontend API client for family, history, and PIN change"
```

---

## Task 5: Family screen

**Files:**
- Create: `web/screens/Family.tsx`
- Modify: `web/components/BottomNav.tsx`
- Modify: `web/main.tsx`

**Interfaces:**
- Consumes: `api.family(): Promise<FamilyMember[]>` (Task 4); `ApiError` (existing,
  `web/api.ts`); `StrikePips` (existing, `web/components/StrikePips.tsx` — takes
  `{used: number, limit: number}`, unchanged); `BottomNav` (existing, modified this task).
- Produces: `Family` component, routed at `/family`.

- [ ] **Step 1: Write `web/screens/Family.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type FamilyMember } from '../api';
import { StrikePips } from '../components/StrikePips';
import { BottomNav } from '../components/BottomNav';

export function Family() {
  const [members, setMembers] = useState<FamilyMember[] | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.family().then((m) => { setMembers(m); setError(''); }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    });
  }, [navigate]);

  if (!members) {
    return (
      <main className="grid min-h-dvh place-items-center text-[var(--color-muted)]">
        Loading…
      </main>
    );
  }

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <h1 className="display mt-4 text-3xl">Family</h1>
        {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}

        <div className="mt-5">
          {members.map((m) => (
            <div key={m.id}
              className="mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-center gap-3">
                <span className="h-6 w-6 rounded-lg" style={{ background: m.color }} aria-hidden />
                <span className="flex-1 text-lg">{m.name}</span>
                <span className="display text-xs text-[var(--color-muted)]">
                  {m.status === 'active'
                    ? `75 ${m.variant === 'hard' ? 'Hard' : 'Soft'} · Attempt ${m.attemptNo}`
                    : 'Not active'}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="display text-2xl">
                  {m.dayNumber !== null
                    ? <>Day <span className="tabular text-[var(--color-primary)]">{m.dayNumber}</span></>
                    : <span className="text-[var(--color-muted)]">—</span>}
                </span>
                <StrikePips used={m.strikes} limit={m.strikeLimit} />
              </div>

              <div className="mt-2 text-xs text-[var(--color-muted)]">
                Best day: <span className="tabular">{m.bestDay ?? '—'}</span>
              </div>
            </div>
          ))}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 2: Flip Family's `enabled` flag in `BottomNav.tsx`**

In `web/components/BottomNav.tsx`, change:

```typescript
  { to: '/family', label: 'Family', Icon: Users,         enabled: false },
```

to:

```typescript
  { to: '/family', label: 'Family', Icon: Users,         enabled: true },
```

- [ ] **Step 3: Wire the route in `web/main.tsx`**

Add the import:

```typescript
import { Family } from './screens/Family';
```

Add the route, alongside the other authenticated routes:

```tsx
        <Route path="/family" element={<Family />} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/screens/Family.tsx web/components/BottomNav.tsx web/main.tsx
git commit -m "feat: Family screen, enabled in bottom nav"
```

---

## Task 6: History and PIN change screens

**Files:**
- Create: `web/screens/History.tsx`
- Create: `web/screens/PinChange.tsx`
- Modify: `web/main.tsx`

**Interfaces:**
- Consumes: `api.history(): Promise<Run[]>`, `api.changePin(currentPin, newPin): Promise<{ok:true}>`
  (both Task 4); `ApiError`, `type Run` (existing, `web/api.ts`).
- Produces: `History` and `PinChange` components, routed at `/me/history` and `/me/pin`
  respectively. Both link back to `/me` (the hub Task 7 creates) via a back button —
  this is a forward reference to Task 7's route, harmless since React Router only
  resolves a link when it's clicked, not at compile time.

- [ ] **Step 1: Write `web/screens/History.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError, type Run } from '../api';
import { BottomNav } from '../components/BottomNav';

export function History() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.history().then((r) => { setRuns(r); setError(''); }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    });
  }, [navigate]);

  const label = (status: Run['status']) =>
    status === 'active' ? 'In progress' : status === 'done' ? '75 done' : 'Ended early';
  const color = (status: Run['status']) =>
    status === 'done' ? 'var(--color-success)'
      : status === 'failed' ? 'var(--color-destructive)' : 'var(--color-muted)';

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <button
          onClick={() => navigate('/me')}
          aria-label="Back to Me"
          className="mb-2 flex items-center gap-1 text-[var(--color-muted)]"
        >
          <ArrowLeft size={18} aria-hidden /> Me
        </button>
        <h1 className="display text-3xl">Run history</h1>

        {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}

        {runs === null ? null : runs.length === 0 ? (
          <p className="mt-4 text-[var(--color-muted)]">No runs yet.</p>
        ) : (
          <div className="mt-5">
            {runs.map((r) => (
              <div key={r.id}
                className="mb-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                <div className="flex items-center justify-between">
                  <span>Attempt {r.attempt_no} · {r.variant === 'hard' ? 'Hard' : 'Soft'}</span>
                  <span className="display text-xs" style={{ color: color(r.status) }}>
                    {label(r.status)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  Started {r.start_date}{r.ended_date ? ` · ended ${r.ended_date}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 2: Write `web/screens/PinChange.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError } from '../api';
import { BottomNav } from '../components/BottomNav';

export function PinChange() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit() {
    setError('');
    setDone(false);
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      setError('PINs must be 4 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('New PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePin(currentPin, newPin);
      setDone(true);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('Current PIN is wrong.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    } finally {
      setBusy(false);
    }
  }

  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 4);

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <button
          onClick={() => navigate('/me')}
          aria-label="Back to Me"
          className="mb-2 flex items-center gap-1 text-[var(--color-muted)]"
        >
          <ArrowLeft size={18} aria-hidden /> Me
        </button>
        <h1 className="display text-3xl">Change PIN</h1>

        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-border)] p-4">
          <label className="display block text-xs text-[var(--color-muted)]" htmlFor="current-pin">
            Current PIN
          </label>
          <input
            id="current-pin" type="password" inputMode="numeric" maxLength={4}
            value={currentPin} onChange={(e) => setCurrentPin(digitsOnly(e.target.value))}
            className="tabular mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />

          <label className="display mt-4 block text-xs text-[var(--color-muted)]" htmlFor="new-pin">
            New PIN
          </label>
          <input
            id="new-pin" type="password" inputMode="numeric" maxLength={4}
            value={newPin} onChange={(e) => setNewPin(digitsOnly(e.target.value))}
            className="tabular mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />

          <label className="display mt-4 block text-xs text-[var(--color-muted)]" htmlFor="confirm-pin">
            Confirm new PIN
          </label>
          <input
            id="confirm-pin" type="password" inputMode="numeric" maxLength={4}
            value={confirmPin} onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
            className="tabular mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />

          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}
          {done && <p className="mt-2 text-sm text-[var(--color-success)]">PIN changed.</p>}

          <button onClick={submit} disabled={busy}
            className="display mt-4 w-full rounded-lg bg-[var(--color-primary)] py-3 disabled:opacity-50">
            {busy ? 'Saving…' : 'Change PIN'}
          </button>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 3: Wire both routes in `web/main.tsx`**

Add the imports:

```typescript
import { History } from './screens/History';
import { PinChange } from './screens/PinChange';
```

Add the routes:

```tsx
        <Route path="/me/history" element={<History />} />
        <Route path="/me/pin" element={<PinChange />} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/screens/History.tsx web/screens/PinChange.tsx web/main.tsx
git commit -m "feat: run history and PIN change screens"
```

---

## Task 7: Me hub screen, GoalsEditor becomes a sub-page, final verification

**Files:**
- Create: `web/screens/Me.tsx`
- Modify: `web/screens/GoalsEditor.tsx`
- Modify: `web/main.tsx`

**Interfaces:**
- Consumes: `api.logout()` (existing); `GoalsEditor`, `History`, `PinChange`, `Family`
  (all in place by end of Task 6).
- Produces: `Me` component, routed at `/me`. `GoalsEditor` moves to `/me/goals`. No
  other file in the codebase imports `GoalsEditor` or references its old `/me` mount
  outside `main.tsx`, so this is a self-contained route change.

- [ ] **Step 1: Write `web/screens/Me.tsx`**

```tsx
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Target, Check, Ban, History as HistoryIcon, KeyRound, LogOut } from 'lucide-react';
import { api } from '../api';
import { BottomNav } from '../components/BottomNav';

const LINKS = [
  { to: '/me/goals', label: 'My goals', Icon: Target },
  { to: '/food/allowed', label: 'Allowed foods', Icon: Check },
  { to: '/food/banned', label: 'Not-allowed foods', Icon: Ban },
  { to: '/me/history', label: 'Run history', Icon: HistoryIcon },
  { to: '/me/pin', label: 'Change PIN', Icon: KeyRound },
] as const;

export function Me() {
  const navigate = useNavigate();

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <h1 className="display mt-4 text-3xl">Me</h1>

        <div className="mt-5">
          {LINKS.map(({ to, label, Icon }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="mb-2 flex w-full items-center gap-3 rounded-xl border
                         border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left"
            >
              <Icon size={20} aria-hidden />
              <span className="flex-1">{label}</span>
              <ChevronRight size={18} aria-hidden className="text-[var(--color-muted)]" />
            </button>
          ))}
        </div>

        <button
          onClick={async () => { await api.logout(); navigate('/login', { replace: true }); }}
          className="display mt-8 flex w-full items-center justify-center gap-2 rounded-xl
                     border border-[var(--color-destructive)] py-3 text-sm
                     text-[var(--color-destructive)]"
        >
          <LogOut size={16} aria-hidden /> Log out
        </button>
      </main>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 2: Give `GoalsEditor` a back button and drop its own Log out button**

In `web/screens/GoalsEditor.tsx`, add `ArrowLeft` to the existing `lucide-react` import:

```typescript
import { Trash2, ArrowLeft } from 'lucide-react';
```

Add a back button as the first child inside the `<main>`, before the `<h1>`:

```tsx
        <button
          onClick={() => navigate('/me')}
          aria-label="Back to Me"
          className="mb-2 flex items-center gap-1 text-[var(--color-muted)]"
        >
          <ArrowLeft size={18} aria-hidden /> Me
        </button>
```

Remove the entire Log out `<button>` block at the end of `<main>` (the one calling
`api.logout()`) — the `Me` hub now owns that action. `ApiError` stays imported (still
used by `load`/`remove`'s catch blocks); `api` stays imported as well (still used by
`load`, `add`, `remove`).

- [ ] **Step 3: Change the routes in `web/main.tsx`**

Add the import:

```typescript
import { Me } from './screens/Me';
```

Change:

```tsx
        <Route path="/me" element={<GoalsEditor />} />
```

to:

```tsx
        <Route path="/me" element={<Me />} />
        <Route path="/me/goals" element={<GoalsEditor />} />
```

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all backend tests pass (the pre-existing 3 known-flaky
`onboarding.test.ts` concurrency cases aside).

- [ ] **Step 5: Manual verification via the dev server**

Start the dev server (`.claude/launch.json` from Phase 2 still points at
`.worktrees/phase2-food-tab` if it exists on disk — if this task runs in a fresh
worktree for Phase 3, update the `runtimeArgs` path to point at the current worktree
before starting the preview). Log in, then walk:

1. Bottom nav: Family tab is now enabled and reachable.
2. `/family`: shows every seeded user, including one who has never onboarded (`—` for
   day number, `Not active` status, `—` best day).
3. `/me`: hub shows five rows (My goals, Allowed foods, Not-allowed foods, Run history,
   Change PIN) plus Log out at the bottom.
4. `/me` → My goals: lands on `/me/goals`, back button returns to `/me`, goal CRUD still
   works exactly as it did in Phase 1 (this screen's own logic is untouched).
5. `/me` → Allowed foods / Not-allowed foods: lands on the existing `/food/:status`
   screen from Phase 2, unchanged, still has its own "← Food" back button (intentional —
   it's shared with the Food tab's own entry point, not re-pointed at Me).
6. `/me` → Run history: shows past runs with correct status labels; back button returns
   to `/me`.
7. `/me` → Change PIN: submit with a wrong current PIN shows "Current PIN is wrong.";
   submit with matching new/confirm PINs succeeds, shows "PIN changed."; log out and
   log back in with the new PIN to confirm it actually took effect, then change it back
   to `1234` so the seeded credentials in `scripts/seed-users.md` stay accurate for
   whoever logs in next.

- [ ] **Step 6: Commit**

```bash
git add web/screens/Me.tsx web/screens/GoalsEditor.tsx web/main.tsx
git commit -m "feat: Me tab hub; goals editor moves to /me/goals"
```

---

## Self-Review Notes

**Spec coverage:**
- §6 API: `GET /api/family` (Task 1), `GET /api/history` (Task 2) — both listed
  explicitly in the spec's API table and previously unimplemented. PIN change has no
  API line in §6's table, but §7's Me screen description explicitly requires it, so
  Task 3 adds `POST /api/me/pin` following the same auth/validation conventions as
  every other mutating route (Zod at the boundary, ownership via the session user).
- §7 Screens — Family: "All members: name, day number, strike pips, attempt number,
  best-ever day. Fully shared. Photos never appear here." — Task 5's `Family.tsx`
  covers every field; photos are Phase 4 scope and genuinely absent from this response
  shape, so there's nothing to accidentally leak.
- §7 Screens — Me: "Goals editor ... food list editors, run history, PIN change, push
  notification toggle with the iOS caveat." Goals editor, food list editors, run
  history, and PIN change are all covered (Tasks 6–7). The push toggle is explicitly
  Phase 5 scope per §12's build order ("Push and PWA" is phase 5, listed after "Social")
  — deliberately deferred, not a gap in this plan.
- §12 Build order item 3 ("Social — Family tab, Me tab, run history"): fully covered.

**Placeholder scan:** No TBD/TODO markers; every step has complete, runnable code; no
"similar to Task N" references — History and PinChange (Task 6) are each written out in
full despite following the same load/error pattern as three earlier screens.

**Type consistency:** `FamilyMember` is defined once in Task 4's `web/api.ts` addition
and only referenced (never redefined) in Task 5's `Family.tsx`. The `FamilyRow` (db
layer, Task 1) → family view model (api layer, Task 1) → `FamilyMember` (frontend,
Task 4) chain uses consistent field names end-to-end (`dayNumber`, `attemptNo`,
`strikeLimit`, `bestDay` — camelCase from the API boundary outward, matching the
existing `MeView`/`DayView` convention already in `web/api.ts`). `Run` (frontee type,
already existing) is reused as-is for history — no parallel `HistoryEntry` type was
introduced, avoiding a duplicate definition of the same shape.

**Known, deliberately out-of-scope items carried forward from Phase 1 (per the user's
original brief: fix only what this phase's work touches):** none of the 7 Phase 1 issues
were touched by Family/History/PIN-change work, so none are addressed here, matching
Phase 2's precedent.
