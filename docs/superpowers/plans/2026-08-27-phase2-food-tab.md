# 75 Hard Tracker — Phase 2: Food Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Food tab — diary-first, shape B. A user sees today's meals and slips at the top, can log a free-text meal (no strike), can tap an item from their own banned list to log a slip (one strike, after a mandatory confirm), and can edit their own Allowed and Not-allowed food lists.

**Architecture:** Same shape as Phase 1. `src/db/food.ts` gains food-item CRUD and food-log queries; a new `src/services/food.ts` is the only place a slip and its strike are written together, in one `db.batch()` — mirroring how `services/onboarding.ts` batches a run with its seed rows. `src/api/food.ts` is a new Hono sub-router mounted at `/api/food`. The frontend gets one new screen (`Food.tsx`) plus a reusable list editor (`FoodListEditor.tsx`) for the two per-status lists, wired into the already-present (but disabled) Food tab in `BottomNav`.

**Tech Stack:** Same as Phase 1 — TypeScript, Cloudflare Workers, Hono, D1, React 19, Vite, Tailwind CSS v4, Zod, Vitest with `@cloudflare/vitest-pool-workers`.

**Source spec:** `docs/superpowers/specs/2026-08-26-75hard-family-tracker-design.md` — §5.7 (food slips), §6 (API), §7 (Food screen).

**Prior work:** Phase 1 is merged and deployed. Schema (`migrations/0001_init.sql`, `migrations/0002_strike_dedup.sql`), auth, Today tab, goals CRUD, and the grading engine already exist and are not touched by this plan except where noted below.

## Global Constraints

Every task's requirements implicitly include this section.

- **Food lists are fully per-user.** Every query in `db/food.ts` filters by `user_id`; every task that adds one needs a test proving a second user cannot read or mutate the first user's rows (the codebase's existing pattern — see `tests/db.test.ts`'s `does not let a second user mutate the first user's goal`).
- **A slip is a strike.** `reason = 'banned_food'`, `ref_id` = the new `food_log` row's id. It is appended through `addStrikeStatement` (Task 1), in the **same `db.batch()`** as the `food_log` insert, so the two rows always land together or neither does.
- **A confirm step is mandatory before a strike is recorded.** The client shows a confirmation naming the item and the strike cost *before* calling the API. The API itself has no separate "confirm" step — the `POST /api/food/log` call for a slip *is* the confirmation's result, so the client must never fire it without the user having seen and accepted the dialog.
- **Slips are never deletable.** `DELETE /api/food/log/:id` only removes rows where `kind = 'meal'`. Do not add a delete path for slips.
- **Meal logging is optional and never penalised.** A meal log write has no effect on the strikes table. Do not add validation that requires logging.
- **The diary date is always the server's `today`**, from `GET /api/me`'s `today.date` — never the device clock. This is the same rule Phase 1's Today screen follows (`web/screens/Today.tsx`), after a real bug where a skewed phone clock struck a user for work they had actually done.
- **A `food_log` row for a slip snapshots the item's name into its `text` column at log time.** This is a deliberate design decision made in this plan (the schema comment in `migrations/0001_init.sql` says `text` is "used for kind='meal'", but nothing forbids writing it for a slip too): without it, the diary would show a blank or broken entry for any slip whose food item was later renamed or deleted. Renaming/deleting a food item never rewrites past `food_log` rows — the ledger is append-only history, and history stays what it was.
- **Strikes are append-only, counted with `COUNT(*)`.** No counter column. Reuse `countStrikes` / `isRunOver` / `failRun` from Phase 1 exactly as the grading engine does — do not reimplement the limit check.
- **`AND user_id = ?` in the db layer is the only ownership boundary.** Every new query needs it, and needs a test that fails without it.
- **UI:** 44×44 px minimum touch targets, 16 px body-copy floor, safe-area insets, `lucide-react` icons (no emoji), `role="alert"` on errors, no colour-only state (a slip's "+1 strike" label is text, not just red colour). Sheets need `role="dialog"`, `aria-modal="true"`, focus management (`autoFocus` on the close button, matching `CounterSheet.tsx`), and Escape-to-close.
- **Frontend error handling follows `web/screens/Today.tsx`:** navigate to `/login` only on `ApiError` with `status === 401`; every other error sets a visible message. Reconcile (reload) before surfacing a write failure, or the reload clears it first — see the `write()` function in `Today.tsx` for the exact pattern.
- **No end-to-end browser tests in v1.** Frontend screens in this plan have no dedicated test files, matching Phase 1's Tasks 13–17. Gates are `tsc --noEmit` and `npm run build`.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`).

**Out of scope, deliberately:** the seven items carried in `.superpowers/sdd/2026-08-26-phase1-foundation/progress.md`'s final section (PIN lockout decay, `catchUpGrading`'s N sequential queries, the noon `setProgress` TOCTOU, the day-75+ materialisation cap, `PATCH /api/goals/:id` on a non-owned goal, `me` mounted twice, `pin_hash` length) are all outside files this plan touches. None are fixed here.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/db/strikes.ts` | *(modified)* exposes `addStrikeStatement`, a prepared-statement variant of `addStrikes`, for atomic batching with another insert |
| `src/db/food.ts` | *(modified)* food-item CRUD + food-log queries, alongside the existing `createBannedFoodStatement` |
| `src/services/food.ts` | *(new)* `logSlip` — the only place a slip and its strike are written together |
| `src/api/food.ts` | *(new)* `GET/POST /api/food/items`, `PATCH/DELETE /api/food/items/:id`, `GET/POST /api/food/log`, `DELETE /api/food/log/:id` |
| `src/api/router.ts` | *(modified)* mounts `food` at `/food` |
| `web/api.ts` | *(modified)* `FoodItem`, `FoodLogEntry`, `SlipResult` types + client methods |
| `web/components/LogMealSheet.tsx` | *(new)* free-text meal entry sheet |
| `web/components/BannedListSheet.tsx` | *(new)* pick-then-confirm slip logging sheet |
| `web/screens/Food.tsx` | *(new)* diary-first Food tab |
| `web/screens/FoodListEditor.tsx` | *(new)* reusable Allowed / Not-allowed list editor, routed by `:status` |
| `web/main.tsx` | *(modified)* adds `/food` and `/food/:status` routes |
| `web/components/BottomNav.tsx` | *(modified)* enables the Food tab |
| `tests/db.test.ts` | *(modified)* adds a case for `addStrikeStatement` |
| `tests/food-items-api.test.ts` | *(new)* |
| `tests/food-log-api.test.ts` | *(new)* |

---

## Task 1: Strikes — a prepared-statement variant for atomic batches

**Files:**
- Modify: `src/db/strikes.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: `newId` from `../lib/ids` (already imported)
- Produces: `addStrikeStatement(db, runId, date, reason, refId, at): D1PreparedStatement` — used by Task 3's `services/food.ts` to batch a slip's `food_log` insert with its strike insert in one transaction

- [ ] **Step 1: Write the failing test**

Add this import and test to the end of `tests/db.test.ts` (the file already imports `addStrikes, countStrikes` from `../src/db/strikes` — extend that import line):

```ts
import { addStrikeStatement, addStrikes, countStrikes } from '../src/db/strikes';
```

```ts
it('addStrikeStatement can be batched atomically with another insert', async () => {
  const run = await createRun(env.DB, 'u1', 'hard', '2026-08-26', 1);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO food_items (id,user_id,name,status) VALUES ('f1','u1','Cake','banned')",
    ),
    addStrikeStatement(env.DB, run.id, '2026-08-26', 'banned_food', 'f1', 5),
  ]);
  expect(await countStrikes(env.DB, run.id)).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- db.test`
Expected: FAIL — `addStrikeStatement` is not exported from `../src/db/strikes`.

- [ ] **Step 3: Implement**

Replace `src/db/strikes.ts` in full with:

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

/** Prepared, unexecuted — for callers that need to submit it as part of a
 *  larger `db.batch()` alongside another insert (e.g. one food_log row plus
 *  its strike, written atomically so neither can land without the other).
 *  `INSERT OR IGNORE` against `strikes_dedup` makes a repeat append a no-op. */
export function addStrikeStatement(
  db: D1Database, runId: string, date: string,
  reason: 'missed_goal' | 'banned_food', refId: string | null, at: number,
): D1PreparedStatement {
  return db.prepare(
    'INSERT OR IGNORE INTO strikes (id,run_id,date,reason,ref_id,at) VALUES (?,?,?,?,?,?)',
  ).bind(newId(), runId, date, reason, refId, at);
}

/** Appends one row per entry. Never clamps — see the global constraints. */
export async function addStrikes(
  db: D1Database, runId: string, date: string,
  reason: 'missed_goal' | 'banned_food', refIds: (string | null)[], at: number,
): Promise<void> {
  if (refIds.length === 0) return;
  await db.batch(refIds.map((ref) => addStrikeStatement(db, runId, date, reason, ref, at)));
}

export async function listStrikes(db: D1Database, runId: string): Promise<StrikeRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM strikes WHERE run_id = ? ORDER BY at',
  ).bind(runId).all<StrikeRow>();
  return results;
}
```

This is a pure refactor of `addStrikes` to call the new exported statement builder — its behaviour (and every existing test that exercises it, including the dedup and overflow cases in `tests/db.test.ts`) must be unchanged.

- [ ] **Step 4: Run tests to verify everything passes**

Run: `npm test -- db.test`
Expected: PASS, including the pre-existing `appends every strike without clamping` and `does not double-count a strike that is appended twice` cases — this proves the refactor did not change `addStrikes`'s behaviour.

- [ ] **Step 5: Verify non-vacuously**

Temporarily remove `OR IGNORE` from the SQL in `addStrikeStatement` and re-run `npm test -- db.test`. Expected: the `does not double-count a strike that is appended twice` test now fails (a `UNIQUE constraint failed` error, uncaught). Put `OR IGNORE` back and confirm the suite is green again. This proves the dedup test actually exercises the guard rather than passing regardless of it.

- [ ] **Step 6: Commit**

```bash
git add src/db/strikes.ts tests/db.test.ts
git commit -m "feat: expose addStrikeStatement for atomic batched strikes"
```

---

## Task 2: Food items CRUD API

**Files:**
- Modify: `src/db/food.ts`
- Create: `src/api/food.ts`
- Modify: `src/api/router.ts`
- Test: `tests/food-items-api.test.ts`

**Interfaces:**
- Consumes: `newId` from `../lib/ids`; `App` type from `./middleware`
- Produces: `FoodItemRow` type; `listFoodItems`, `getFoodItem`, `createFoodItem`, `updateFoodItem`, `deleteFoodItem`, `isFoodItemNameConflict` from `src/db/food.ts` — `getFoodItem` and the row shape are consumed by Task 3's slip-logging route. `GET/POST /api/food/items`, `PATCH/DELETE /api/food/items/:id`.

- [ ] **Step 1: Write the failing tests**

Create `tests/food-items-api.test.ts`:

```ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM food_log'),
    env.DB.prepare('DELETE FROM food_items'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind('u1', 'A', '#EA580C', hash, salt, Date.now()),
    env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind('u2', 'B', '#000000', hash, salt, Date.now()),
  ]);
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

it('creates and lists food items', async () => {
  await req('/api/food/items', 'POST', { name: 'Ice cream', status: 'banned' });
  await req('/api/food/items', 'POST', { name: 'Chicken', status: 'allowed' });
  const res = await req('/api/food/items', 'GET');
  expect(res.status).toBe(200);
  const items = await res.json<{ name: string; status: string }[]>();
  expect(items.map((i) => i.name).sort()).toEqual(['Chicken', 'Ice cream']);
});

it('rejects a duplicate name for the same user with 409', async () => {
  await req('/api/food/items', 'POST', { name: 'Cake', status: 'banned' });
  const res = await req('/api/food/items', 'POST', { name: 'Cake', status: 'allowed' });
  expect(res.status).toBe(409);
});

it('updates and deletes only the owner\'s item', async () => {
  const created = await req('/api/food/items', 'POST', { name: 'Soda', status: 'banned' })
    .then((r) => r.json<{ id: string }>());

  const patch = await req(`/api/food/items/${created.id}`, 'PATCH', { name: 'Soda', status: 'allowed' });
  expect(patch.status).toBe(200);

  const del = await req(`/api/food/items/${created.id}`, 'DELETE');
  expect(del.status).toBe(200);

  const gone = await env.DB.prepare('SELECT * FROM food_items WHERE id = ?').bind(created.id).first();
  expect(gone).toBeNull();
});

it('404s a PATCH or DELETE from a user who does not own the item', async () => {
  const created = await req('/api/food/items', 'POST', { name: 'Beer', status: 'banned' })
    .then((r) => r.json<{ id: string }>());

  const loginB = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u2', pin: '1234' }),
  });
  const cookieB = (loginB.headers.get('set-cookie') ?? '').split(';')[0]!;

  const patch = await SELF.fetch(`https://example.com/api/food/items/${created.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', cookie: cookieB },
    body: JSON.stringify({ name: 'Hijacked', status: 'allowed' }),
  });
  expect(patch.status).toBe(404);

  const still = await env.DB.prepare('SELECT name FROM food_items WHERE id = ?')
    .bind(created.id).first<{ name: string }>();
  expect(still?.name).toBe('Beer');

  const del = await SELF.fetch(`https://example.com/api/food/items/${created.id}`, {
    method: 'DELETE', headers: { cookie: cookieB },
  });
  expect(del.status).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- food-items-api`
Expected: FAIL — `/api/food/items` does not exist yet (404s from the router, or a network error from `SELF.fetch` against an unmounted route).

- [ ] **Step 3: Extend `src/db/food.ts`**

Replace the file in full with:

```ts
import { newId } from '../lib/ids';

export type FoodItemRow = {
  id: string; user_id: string; name: string; status: 'allowed' | 'banned';
};

export async function listFoodItems(db: D1Database, userId: string): Promise<FoodItemRow[]> {
  const { results } = await db.prepare('SELECT * FROM food_items WHERE user_id = ? ORDER BY name')
    .bind(userId).all<FoodItemRow>();
  return results;
}

export function getFoodItem(db: D1Database, userId: string, id: string): Promise<FoodItemRow | null> {
  return db.prepare('SELECT * FROM food_items WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<FoodItemRow>();
}

/** Prepared, unexecuted — for callers that need to submit it as part of a
 *  larger `db.batch()` (one implicit transaction) alongside other inserts.
 *  Used by services/onboarding.ts to seed the Hard/Soft preset's starter
 *  banned list alongside the run and goal rows. */
export function createBannedFoodStatement(
  db: D1Database, userId: string, name: string,
): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO food_items (id,user_id,name,status) VALUES (?,?,?,'banned')",
  ).bind(newId(), userId, name);
}

export async function createFoodItem(
  db: D1Database, userId: string, name: string, status: 'allowed' | 'banned',
): Promise<FoodItemRow> {
  const id = newId();
  await db.prepare('INSERT INTO food_items (id,user_id,name,status) VALUES (?,?,?,?)')
    .bind(id, userId, name, status).run();
  return { id, user_id: userId, name, status };
}

/** Ownership is the WHERE clause. Returns false for a wrong owner or a
 *  missing id — the caller maps that to 404. */
export async function updateFoodItem(
  db: D1Database, userId: string, id: string, name: string, status: 'allowed' | 'banned',
): Promise<boolean> {
  const res = await db.prepare('UPDATE food_items SET name = ?, status = ? WHERE id = ? AND user_id = ?')
    .bind(name, status, id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteFoodItem(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM food_items WHERE id = ? AND user_id = ?')
    .bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** True iff `err` is the UNIQUE(user_id,name) violation from createFoodItem
 *  or updateFoodItem — this user already has an item with this exact name.
 *  Matched on the D1 error text for that index, same pattern as
 *  services/onboarding.ts's isActiveRunConflict. */
export function isFoodItemNameConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed: food_items');
}
```

- [ ] **Step 4: Create `src/api/food.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import {
  listFoodItems, createFoodItem, updateFoodItem, deleteFoodItem, isFoodItemNameConflict,
} from '../db/food';
import type { App } from './middleware';

export const food = new Hono<App>();

const itemSchema = z.object({
  name: z.string().trim().min(1).max(60),
  status: z.enum(['allowed', 'banned']),
});

food.get('/items', async (c) => {
  return c.json(await listFoodItems(c.env.DB, c.get('user').id));
});

food.post('/items', async (c) => {
  const parsed = itemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);
  try {
    const item = await createFoodItem(c.env.DB, c.get('user').id, parsed.data.name, parsed.data.status);
    return c.json(item);
  } catch (err) {
    if (isFoodItemNameConflict(err)) return c.json({ error: 'already on your list' }, 409);
    throw err;
  }
});

food.patch('/items/:id', async (c) => {
  const parsed = itemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);
  try {
    const updated = await updateFoodItem(
      c.env.DB, c.get('user').id, c.req.param('id'), parsed.data.name, parsed.data.status,
    );
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  } catch (err) {
    if (isFoodItemNameConflict(err)) return c.json({ error: 'already on your list' }, 409);
    throw err;
  }
});

food.delete('/items/:id', async (c) => {
  const deleted = await deleteFoodItem(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!deleted) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Mount the router**

In `src/api/router.ts`, add the import and route (after the `goals` import/route, before `days`):

```ts
import { food } from './food';
```

```ts
api.route('/food', food);  // GET/POST /api/food/items, PATCH/DELETE /api/food/items/:id
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- food-items-api`
Expected: PASS.

- [ ] **Step 7: Verify the ownership boundary non-vacuously**

Temporarily change `updateFoodItem`'s WHERE clause to drop `AND user_id = ?` and re-run `npm test -- food-items-api`. Expected: `404s a PATCH or DELETE from a user who does not own the item` now fails (the patch succeeds and the name check on `still?.name` fails). Revert and confirm green again.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/db/food.ts src/api/food.ts src/api/router.ts tests/food-items-api.test.ts
git commit -m "feat: food items CRUD API"
```

---

## Task 3: Food log — meals, slips, and the strike they cause

**Files:**
- Modify: `src/db/food.ts`
- Create: `src/services/food.ts`
- Modify: `src/api/food.ts`
- Test: `tests/food-log-api.test.ts`

**Interfaces:**
- Consumes: `getFoodItem`, `FoodItemRow` from Task 2's `src/db/food.ts`; `addStrikeStatement`, `countStrikes` from Task 1's `src/db/strikes.ts`; `getActiveRun`, `failRun`, `RunRow` from `../db/runs`; `isRunOver`, `STRIKE_LIMIT` from `../lib/rules`; `todayIST` from `../lib/dates`
- Produces: `FoodLogRow` type; `listFoodLog`, `createMealLog`, `createSlipLogStatement`, `deleteMealLog` from `src/db/food.ts`; `logSlip(db, run, userId, foodItemId, foodItemName, date, at): Promise<SlipResult>` from `src/services/food.ts`. `GET/POST /api/food/log`, `DELETE /api/food/log/:id`.

- [ ] **Step 1: Write the failing tests**

Create `tests/food-log-api.test.ts`:

```ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';
import { getActiveRun } from '../src/db/runs';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

let cookie = '';
let today = '';

function req(path: string, method: string, body?: unknown) {
  return SELF.fetch(`https://example.com${path}`, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM strikes'), env.DB.prepare('DELETE FROM food_log'),
    env.DB.prepare('DELETE FROM food_items'), env.DB.prepare('DELETE FROM progress'),
    env.DB.prepare('DELETE FROM days'), env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  await env.DB.prepare(
    'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
  ).bind('u1', 'A', '#EA580C', hash, salt, Date.now()).run();

  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;

  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await req('/api/onboarding', 'POST', { variant: 'soft', startDate: today });
});

it('logs a meal with no effect on strikes', async () => {
  const res = await req('/api/food/log', 'POST', { kind: 'meal', text: 'Oats and eggs' });
  expect(res.status).toBe(200);
  const body = await res.json<{ log: { kind: string; text: string } }>();
  expect(body.log.kind).toBe('meal');
  expect(body.log.text).toBe('Oats and eggs');

  const list = await req(`/api/food/log?date=${today}`, 'GET');
  expect(await list.json<unknown[]>()).toHaveLength(1);

  const run = await getActiveRun(env.DB, 'u1');
  const strikes = await env.DB.prepare('SELECT COUNT(*) AS n FROM strikes WHERE run_id = ?')
    .bind(run!.id).first<{ n: number }>();
  expect(strikes?.n).toBe(0);
});

it('logging a slip appends exactly one strike', async () => {
  const item = await req('/api/food/items', 'POST', { name: 'Ice cream', status: 'banned' })
    .then((r) => r.json<{ id: string }>());

  const res = await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: item.id });
  expect(res.status).toBe(200);
  const body = await res.json<{ strikeCount: number; limit: number; runFailed: boolean }>();
  expect(body.strikeCount).toBe(1);
  expect(body.limit).toBe(3);
  expect(body.runFailed).toBe(false);

  const run = await getActiveRun(env.DB, 'u1');
  const strikes = await env.DB.prepare('SELECT COUNT(*) AS n FROM strikes WHERE run_id = ?')
    .bind(run!.id).first<{ n: number }>();
  expect(strikes?.n).toBe(1);
});

it('a third strike fails the run in the same response', async () => {
  const ids: string[] = [];
  for (const name of ['A', 'B', 'C']) {
    const item = await req('/api/food/items', 'POST', { name, status: 'banned' })
      .then((r) => r.json<{ id: string }>());
    ids.push(item.id);
  }

  await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: ids[0] });
  await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: ids[1] });
  const third = await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: ids[2] });
  const body = await third.json<{ strikeCount: number; runFailed: boolean }>();
  expect(body.strikeCount).toBe(3);
  expect(body.runFailed).toBe(true);

  expect(await getActiveRun(env.DB, 'u1')).toBeNull();
});

it('rejects logging an item that is not on the banned list', async () => {
  const item = await req('/api/food/items', 'POST', { name: 'Chicken', status: 'allowed' })
    .then((r) => r.json<{ id: string }>());
  const res = await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: item.id });
  expect(res.status).toBe(400);
});

it('deletes a meal but refuses to delete a slip', async () => {
  const meal = await req('/api/food/log', 'POST', { kind: 'meal', text: 'Salad' })
    .then((r) => r.json<{ log: { id: string } }>());
  const delMeal = await req(`/api/food/log/${meal.log.id}`, 'DELETE');
  expect(delMeal.status).toBe(200);

  const item = await req('/api/food/items', 'POST', { name: 'Cake', status: 'banned' })
    .then((r) => r.json<{ id: string }>());
  const slip = await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: item.id })
    .then((r) => r.json<{ log: { id: string } }>());
  const delSlip = await req(`/api/food/log/${slip.log.id}`, 'DELETE');
  expect(delSlip.status).toBe(404);

  const still = await env.DB.prepare('SELECT * FROM food_log WHERE id = ?')
    .bind(slip.log.id).first();
  expect(still).not.toBeNull();
});

it('a slip survives its food item being deleted, keeping the name in the diary', async () => {
  const item = await req('/api/food/items', 'POST', { name: 'Beer', status: 'banned' })
    .then((r) => r.json<{ id: string }>());
  await req('/api/food/log', 'POST', { kind: 'slip', foodItemId: item.id });
  await req(`/api/food/items/${item.id}`, 'DELETE');

  const list = await req(`/api/food/log?date=${today}`, 'GET');
  const entries = await list.json<{ text: string }[]>();
  expect(entries).toHaveLength(1);
  expect(entries[0]!.text).toBe('Beer');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- food-log-api`
Expected: FAIL — `/api/food/log` does not exist yet.

- [ ] **Step 3: Add food-log queries to `src/db/food.ts`**

Append to the end of `src/db/food.ts` (keep everything already in the file from Task 2):

```ts
export type FoodLogRow = {
  id: string; user_id: string; run_id: string; date: string;
  kind: 'meal' | 'slip'; text: string | null; food_item_id: string | null; at: number;
};

export async function listFoodLog(db: D1Database, userId: string, date: string): Promise<FoodLogRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM food_log WHERE user_id = ? AND date = ? ORDER BY at',
  ).bind(userId, date).all<FoodLogRow>();
  return results;
}

export async function createMealLog(
  db: D1Database, userId: string, runId: string, date: string, text: string, at: number,
): Promise<FoodLogRow> {
  const id = newId();
  await db.prepare(
    `INSERT INTO food_log (id,user_id,run_id,date,kind,text,food_item_id,at)
     VALUES (?,?,?,?,'meal',?,NULL,?)`,
  ).bind(id, userId, runId, date, text, at).run();
  return { id, user_id: userId, run_id: runId, date, kind: 'meal', text, food_item_id: null, at };
}

/** Prepared, unexecuted — batched atomically with its strike row by
 *  services/food.ts's logSlip, so a slip and its strike always land
 *  together. `text` snapshots the item's name at log time — see the
 *  global constraints on why this survives a later rename or delete. */
export function createSlipLogStatement(
  db: D1Database, id: string, userId: string, runId: string,
  date: string, foodItemId: string, name: string, at: number,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO food_log (id,user_id,run_id,date,kind,text,food_item_id,at)
     VALUES (?,?,?,?,'slip',?,?,?)`,
  ).bind(id, userId, runId, date, name, foodItemId, at);
}

/** Meals only — ownership plus kind='meal' in the WHERE clause. Slips are
 *  never deletable: a strike, once earned, stands (spec §6). */
export async function deleteMealLog(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(
    "DELETE FROM food_log WHERE id = ? AND user_id = ? AND kind = 'meal'",
  ).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
```

- [ ] **Step 4: Create `src/services/food.ts`**

```ts
import { newId } from '../lib/ids';
import { isRunOver, STRIKE_LIMIT } from '../lib/rules';
import { failRun, type RunRow } from '../db/runs';
import { createSlipLogStatement, type FoodLogRow } from '../db/food';
import { addStrikeStatement, countStrikes } from '../db/strikes';

export type SlipResult = {
  log: FoodLogRow;
  strikeCount: number;
  limit: number;
  runFailed: boolean;
};

/**
 * Logs a banned-food slip and its strike in one `db.batch()` — spec §5.7
 * requires both to land together, never one without the other. If this
 * pushes the run's strike count to the limit, the run is failed within the
 * same call, so the caller can redirect to the reset screen immediately
 * rather than waiting for the next grading pass.
 */
export async function logSlip(
  db: D1Database, run: RunRow, userId: string,
  foodItemId: string, foodItemName: string, date: string, at: number,
): Promise<SlipResult> {
  const id = newId();
  await db.batch([
    createSlipLogStatement(db, id, userId, run.id, date, foodItemId, foodItemName, at),
    addStrikeStatement(db, run.id, date, 'banned_food', id, at),
  ]);

  const strikeCount = await countStrikes(db, run.id);
  const runFailed = isRunOver(strikeCount);
  if (runFailed) await failRun(db, run.id, date);

  return {
    log: {
      id, user_id: userId, run_id: run.id, date,
      kind: 'slip', text: foodItemName, food_item_id: foodItemId, at,
    },
    strikeCount,
    limit: STRIKE_LIMIT,
    runFailed,
  };
}
```

- [ ] **Step 5: Add the log routes to `src/api/food.ts`**

Update the top of `src/api/food.ts` to add these imports (alongside the existing ones):

```ts
import { todayIST } from '../lib/dates';
import { getActiveRun } from '../db/runs';
import {
  listFoodItems, getFoodItem, createFoodItem, updateFoodItem, deleteFoodItem,
  isFoodItemNameConflict, listFoodLog, createMealLog, deleteMealLog,
} from '../db/food';
import { logSlip } from '../services/food';
```

Append to the end of the file (after the existing `food.delete('/items/:id', ...)` block):

```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const logSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('meal'), text: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal('slip'), foodItemId: z.string().min(1) }),
]);

food.get('/log', async (c) => {
  const date = c.req.query('date');
  if (!date || !DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);
  return c.json(await listFoodLog(c.env.DB, c.get('user').id, date));
});

food.post('/log', async (c) => {
  const parsed = logSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request' }, 400);

  const user = c.get('user');
  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 404);
  const now = new Date();
  const date = todayIST(now);

  if (parsed.data.kind === 'meal') {
    const log = await createMealLog(c.env.DB, user.id, run.id, date, parsed.data.text, now.getTime());
    return c.json({ log });
  }

  const item = await getFoodItem(c.env.DB, user.id, parsed.data.foodItemId);
  if (!item) return c.json({ error: 'not found' }, 404);
  if (item.status !== 'banned') return c.json({ error: 'that item is not on your banned list' }, 400);

  const result = await logSlip(c.env.DB, run, user.id, item.id, item.name, date, now.getTime());
  return c.json(result);
});

food.delete('/log/:id', async (c) => {
  const deleted = await deleteMealLog(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!deleted) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- food-log-api`
Expected: PASS.

- [ ] **Step 7: Verify the slip/strike atomicity non-vacuously**

Temporarily change `services/food.ts`'s `logSlip` to run the two statements as two separate `.run()` calls instead of one `db.batch()`, then have the test suite's `a third strike fails the run in the same response` case still pass (it would, since D1 executes sequential statements fine when nothing crashes). This proves the test as written cannot tell atomic from sequential — which is expected here, because true crash-mid-write is not producible in this harness (the same limitation Phase 1's ledger recorded for the claim/append ordering). Revert to `db.batch()`. Record in the task's commit message or PR description that the atomicity is structural (one `batch()` call, D1's implicit transaction) rather than test-proven, matching the precedent in `.superpowers/sdd/2026-08-26-phase1-foundation/progress.md`.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/db/food.ts src/services/food.ts src/api/food.ts tests/food-log-api.test.ts
git commit -m "feat: food log API with slip-strike integration"
```

---

## Task 4: Frontend API client

**Files:**
- Modify: `web/api.ts`

**Interfaces:**
- Consumes: nothing new (same `call<T>` helper already in the file)
- Produces: `FoodItem`, `FoodLogEntry`, `SlipResult` types; `api.foodItems`, `api.addFoodItem`, `api.updateFoodItem`, `api.deleteFoodItem`, `api.foodLog`, `api.logMeal`, `api.logSlip`, `api.deleteFoodLog` — consumed by Task 5's `Food.tsx` and Task 6's `FoodListEditor.tsx`

- [ ] **Step 1: Add types**

In `web/api.ts`, add after the existing `MeView` type:

```ts
export type FoodItem = { id: string; name: string; status: 'allowed' | 'banned' };
export type FoodLogEntry = {
  id: string; date: string; kind: 'meal' | 'slip';
  text: string | null; food_item_id: string | null; at: number;
};
export type SlipResult = { log: FoodLogEntry; strikeCount: number; limit: number; runFailed: boolean };
```

- [ ] **Step 2: Add client methods**

In `web/api.ts`, add to the `api` object (after the existing `deleteGoal` entry):

```ts
  foodItems: () => call<FoodItem[]>('/api/food/items'),
  addFoodItem: (name: string, status: 'allowed' | 'banned') =>
    call<FoodItem>('/api/food/items', { method: 'POST', body: JSON.stringify({ name, status }) }),
  updateFoodItem: (id: string, name: string, status: 'allowed' | 'banned') =>
    call<{ ok: true }>(`/api/food/items/${id}`, { method: 'PATCH', body: JSON.stringify({ name, status }) }),
  deleteFoodItem: (id: string) => call<{ ok: true }>(`/api/food/items/${id}`, { method: 'DELETE' }),

  foodLog: (date: string) => call<FoodLogEntry[]>(`/api/food/log?date=${date}`),
  logMeal: (text: string) =>
    call<{ log: FoodLogEntry }>('/api/food/log', {
      method: 'POST', body: JSON.stringify({ kind: 'meal', text }),
    }),
  logSlip: (foodItemId: string) =>
    call<SlipResult>('/api/food/log', {
      method: 'POST', body: JSON.stringify({ kind: 'slip', foodItemId }),
    }),
  deleteFoodLog: (id: string) => call<{ ok: true }>(`/api/food/log/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/api.ts
git commit -m "feat: frontend API client for food items and log"
```

---

## Task 5: Food screen — diary, meal logging, slip confirm flow

**Files:**
- Create: `web/components/LogMealSheet.tsx`
- Create: `web/components/BannedListSheet.tsx`
- Create: `web/screens/Food.tsx`

**Interfaces:**
- Consumes: `api.me`, `api.foodLog`, `api.foodItems`, `api.logMeal`, `api.logSlip`, `FoodItem`, `FoodLogEntry`, `MeView`, `ApiError` from `../api`; `BottomNav` from `../components/BottomNav`
- Produces: `Food` screen component, wired into routing by Task 7. `LogMealSheet` and `BannedListSheet` are also consumed only here.

No dedicated test file — per the Global Constraints, frontend screens are gated by `tsc --noEmit` and `npm run build`, matching Phase 1's Tasks 13–17.

- [ ] **Step 1: Create `web/components/LogMealSheet.tsx`**

```tsx
import { useState } from 'react';
import { X } from 'lucide-react';

export function LogMealSheet({
  onClose, onSave,
}: { onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState('');

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Log a meal"
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="w-full rounded-t-2xl border-t border-[var(--color-border)]
                   bg-[var(--color-card)] p-6"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display text-xl">Log a meal</h2>
          <button onClick={onClose} aria-label="Close" autoFocus><X size={22} aria-hidden /></button>
        </div>

        <label className="sr-only" htmlFor="meal-text">What did you eat?</label>
        <textarea
          id="meal-text" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Grilled chicken, rice, salad"
          rows={3}
          className="w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
        />

        <button
          disabled={!text.trim()}
          onClick={() => { onSave(text.trim()); onClose(); }}
          className="display mt-4 w-full rounded-xl bg-[var(--color-primary)] py-4 text-lg disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/components/BannedListSheet.tsx`**

```tsx
import { useState } from 'react';
import { X } from 'lucide-react';
import type { FoodItem } from '../api';

export function BannedListSheet({
  items, strikesUsed, strikeLimit, onClose, onConfirm,
}: {
  items: FoodItem[]; strikesUsed: number; strikeLimit: number;
  onClose: () => void; onConfirm: (item: FoodItem) => void;
}) {
  const [picked, setPicked] = useState<FoodItem | null>(null);
  const cost = strikesUsed + 1;

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Log a slip"
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="w-full rounded-t-2xl border-t border-[var(--color-border)]
                   bg-[var(--color-card)] p-6"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display text-xl">{picked ? 'Confirm' : 'Not-allowed list'}</h2>
          <button onClick={onClose} aria-label="Close" autoFocus><X size={22} aria-hidden /></button>
        </div>

        {!picked && (
          items.length === 0 ? (
            <p className="text-[var(--color-muted)]">Nothing on your not-allowed list yet.</p>
          ) : (
            <div>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setPicked(item)}
                  className="mb-2 flex w-full items-center justify-between rounded-xl border
                             border-[var(--color-border)] bg-[var(--color-background)] p-3 text-left"
                >
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          )
        )}

        {picked && (
          <div>
            <p className="text-lg">
              Log <strong>{picked.name}</strong>? That&rsquo;s strike{' '}
              <span className="tabular">{cost}</span> of <span className="tabular">{strikeLimit}</span>.
            </p>
            <p className="mt-2 text-[var(--color-muted)]">
              A strike, once logged, cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setPicked(null)}
                className="display flex-1 rounded-xl border border-[var(--color-border)] py-3"
              >
                Back
              </button>
              <button
                onClick={() => { onConfirm(picked); onClose(); }}
                className="display flex-1 rounded-xl bg-[var(--color-destructive)] py-3"
              >
                Log it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/screens/Food.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type FoodItem, type FoodLogEntry, type MeView } from '../api';
import { LogMealSheet } from '../components/LogMealSheet';
import { BannedListSheet } from '../components/BannedListSheet';
import { BottomNav } from '../components/BottomNav';

export function Food() {
  const [me, setMe] = useState<MeView | null>(null);
  const [entries, setEntries] = useState<FoodLogEntry[] | null>(null);
  const [items, setItems] = useState<FoodItem[]>([]);
  const [mealSheet, setMealSheet] = useState(false);
  const [bannedSheet, setBannedSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setError(null);
      if (m.needsOnboarding) return navigate('/onboarding', { replace: true });
      if (!m.run) return navigate('/run-over', { replace: true });
      // The diary date always comes from the server's today, never the
      // device clock — see the global constraints.
      const date = m.today!.date;
      const [log, foodItems] = await Promise.all([api.foodLog(date), api.foodItems()]);
      setEntries(log);
      setItems(foodItems);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    }
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  async function saveMeal(text: string) {
    let failure: string | null = null;
    try {
      await api.logMeal(text);
    } catch (e) {
      failure = e instanceof ApiError ? e.message : 'Could not reach the server';
    }
    await load();
    if (failure) setError(failure);
  }

  async function confirmSlip(item: FoodItem) {
    try {
      const result = await api.logSlip(item.id);
      if (result.runFailed) {
        navigate('/run-over', { replace: true });
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server');
    }
  }

  if (!me?.run || !entries) {
    return <main className="grid min-h-dvh place-items-center text-[var(--color-muted)]">Loading…</main>;
  }

  const banned = items.filter((i) => i.status === 'banned');
  const allowed = items.filter((i) => i.status === 'allowed');

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <h1 className="display mt-4 text-3xl">Food</h1>

        {error && <p role="alert" className="mt-3 text-[var(--color-destructive)]">{error}</p>}

        <div className="mt-4">
          {entries.length === 0 && (
            <p className="text-[var(--color-muted)]">Nothing logged yet today.</p>
          )}
          {entries.map((e) => (
            <div
              key={e.id}
              className="mb-2 rounded-xl border p-3"
              style={{
                borderColor: e.kind === 'slip' ? 'var(--color-destructive)' : 'var(--color-border)',
                background: 'var(--color-card)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: e.kind === 'slip' ? 'var(--color-destructive)' : undefined }}>
                  {e.text}
                </span>
                {e.kind === 'slip' && (
                  <span className="display flex-none text-xs text-[var(--color-destructive)]">
                    +1 strike
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setMealSheet(true)}
          className="display mt-4 w-full rounded-xl bg-[var(--color-primary)] py-4 text-lg"
        >
          Log a meal
        </button>
        <button
          onClick={() => setBannedSheet(true)}
          className="display mt-3 w-full rounded-xl border border-[var(--color-destructive)]
                     py-3 text-[var(--color-destructive)]"
        >
          Log a slip
        </button>

        <div className="mt-6 flex gap-3">
          <Link to="/food/allowed"
            className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <div className="display text-xs text-[var(--color-muted)]">Allowed</div>
            <div className="tabular text-2xl">{allowed.length}</div>
          </Link>
          <Link to="/food/banned"
            className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <div className="display text-xs text-[var(--color-muted)]">Not allowed</div>
            <div className="tabular text-2xl">{banned.length}</div>
          </Link>
        </div>
      </main>

      {mealSheet && <LogMealSheet onClose={() => setMealSheet(false)} onSave={saveMeal} />}
      {bannedSheet && (
        <BannedListSheet
          items={banned}
          strikesUsed={me.strikes?.used ?? 0}
          strikeLimit={me.strikes?.limit ?? 3}
          onClose={() => setBannedSheet(false)}
          onConfirm={confirmSlip}
        />
      )}

      <BottomNav />
    </>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. (`Food` is not yet routed, so an "unused" warning is not raised by `tsc` — this project has no `noUnusedLocals`.)

- [ ] **Step 5: Commit**

```bash
git add web/components/LogMealSheet.tsx web/components/BannedListSheet.tsx web/screens/Food.tsx
git commit -m "feat: Food screen with diary, meal logging, and slip confirm flow"
```

---

## Task 6: Allowed / Not-allowed list editor

**Files:**
- Create: `web/screens/FoodListEditor.tsx`

**Interfaces:**
- Consumes: `api.foodItems`, `api.addFoodItem`, `api.deleteFoodItem`, `FoodItem`, `ApiError` from `../api`; `BottomNav` from `../components/BottomNav`; a route param `:status` (`'allowed' | 'banned'`), wired by Task 7
- Produces: `FoodListEditor` screen component

No dedicated test file, same reasoning as Task 5.

- [ ] **Step 1: Create `web/screens/FoodListEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2, ArrowLeft } from 'lucide-react';
import { api, ApiError, type FoodItem } from '../api';
import { BottomNav } from '../components/BottomNav';

export function FoodListEditor() {
  const { status: param } = useParams<{ status: string }>();
  const status: 'allowed' | 'banned' = param === 'banned' ? 'banned' : 'allowed';
  const [items, setItems] = useState<FoodItem[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = () =>
    api.foodItems().then((all) => {
      setItems(all.filter((i) => i.status === status));
      setError('');
    }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [status]);

  async function add() {
    if (!name.trim()) return setError('Give it a name.');
    setError('');
    setBusy(true);
    try {
      await api.addFoodItem(name.trim(), status);
      setName('');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('Already on your list.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: FoodItem) {
    let failure: string | null = null;
    try {
      await api.deleteFoodItem(item.id);
    } catch (e) {
      failure = e instanceof ApiError ? e.message : 'Could not reach the server';
    }
    await load();
    if (failure) setError(failure);
  }

  const title = status === 'banned' ? 'Not allowed' : 'Allowed';

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <button
          onClick={() => navigate('/food')}
          aria-label="Back to Food"
          className="mb-2 flex items-center gap-1 text-[var(--color-muted)]"
        >
          <ArrowLeft size={18} aria-hidden /> Food
        </button>
        <h1 className="display text-3xl">{title}</h1>

        <div className="mt-5">
          {items.map((item) => (
            <div key={item.id}
              className="mb-2 flex items-center gap-3 rounded-xl border
                         border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <span className="flex-1">{item.name}</span>
              <button
                onClick={() => remove(item)}
                aria-label={`Remove ${item.name}`}
                className="text-[var(--color-destructive)]"
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-border)] p-4">
          <label className="display block text-xs text-[var(--color-muted)]" htmlFor="item-name">
            Add to {title.toLowerCase()}
          </label>
          <input
            id="item-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ice cream"
            className="mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}
          <button onClick={add} disabled={busy}
            className="display mt-4 w-full rounded-lg bg-[var(--color-primary)] py-3 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add web/screens/FoodListEditor.tsx
git commit -m "feat: Allowed / Not-allowed food list editor"
```

---

## Task 7: Wire routing, enable the Food tab, and verify in the browser

**Files:**
- Modify: `web/main.tsx`
- Modify: `web/components/BottomNav.tsx`

**Interfaces:**
- Consumes: `Food` from `./screens/Food`, `FoodListEditor` from `./screens/FoodListEditor`
- Produces: `/food` and `/food/:status` routes; Food tab enabled in the bottom nav

- [ ] **Step 1: Add routes to `web/main.tsx`**

Add imports (alongside the existing screen imports):

```ts
import { Food } from './screens/Food';
import { FoodListEditor } from './screens/FoodListEditor';
```

Add routes inside `<Routes>` (after the `/today` route):

```tsx
<Route path="/food" element={<Food />} />
<Route path="/food/:status" element={<FoodListEditor />} />
```

- [ ] **Step 2: Enable the Food tab in `web/components/BottomNav.tsx`**

Change:

```ts
{ to: '/food',   label: 'Food',   Icon: Utensils,      enabled: false },
```

to:

```ts
{ to: '/food',   label: 'Food',   Icon: Utensils,      enabled: true },
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all backend tests from Tasks 1–3, plus every pre-existing Phase 1 test, still green.

- [ ] **Step 5: Manual verification in the browser**

Start the dev server (`npm run dev`), log in as the seeded user, and walk the golden path plus the two edge cases the automated tests cannot reach (nothing renders behind a mouse click the same way it renders behind `SELF.fetch`):

1. Open the Food tab from the bottom nav. Confirm it navigates and no longer shows as disabled.
2. Tap "Log a meal", type free text, save. Confirm it appears in the diary immediately and the strike pips (visible on the Today tab) are unchanged.
3. Go to the "Not allowed" row, add an item (e.g. "Ice cream"), go back to Food.
4. Tap "Log a slip", tap "Ice cream", confirm the dialog reads "strike 1 of 3", confirm it. Verify the diary shows it in red with "+1 strike", and the Today tab's strike pips now show 1/3.
5. Repeat twice more with two different banned items to reach 3 strikes. Confirm the third confirm-and-log redirects straight to the Run Over screen (no need to reload).
6. Log back in (via reset), confirm the Allowed/Not-allowed counts on the Food screen match what was added, and that deleting an item from the "Not allowed" list editor works and does not remove any already-logged diary entries for it.
7. Check touch target sizes and the confirm sheet's Escape-to-close behaviour at 375px width, matching the verification already done for `CounterSheet` in Phase 1.

Record the outcome (pass, or what broke) — this step has no automated substitute per the Global Constraints' "no end-to-end browser tests in v1" rule, so it is the only place these flows are actually exercised before merge.

- [ ] **Step 6: Commit**

```bash
git add web/main.tsx web/components/BottomNav.tsx
git commit -m "feat: wire Food tab routing and enable it in the bottom nav"
```

---

## Self-Review Notes

- **Spec coverage:** §5.7 (slip is a strike, confirm mandatory, meal has no effect, slip not deletable) → Task 3. §6 API surface (`/api/food/items` CRUD, `/api/food/log` GET/POST, `DELETE /api/food/log/:id`) → Tasks 2–3, matches exactly. §7 Food screen (diary-first, chronological, slips flagged red with cost, two rows into Allowed/Not-allowed editors, primary "Log a meal" + secondary slip path) → Tasks 5–6. Per-user food lists, append-only strikes, `AND user_id = ?` ownership boundary → Global Constraints, enforced with an explicit non-vacuous test in Task 2 Step 7.
- **No placeholders:** every step above contains complete file contents or an exact diff instruction; no task says "similar to Task N" without repeating the code.
- **Type consistency:** `FoodItemRow`/`FoodItem`, `FoodLogRow`/`FoodLogEntry`, and `SlipResult` are defined once (Tasks 2–4) and referenced by the same names in every later task; `logSlip`'s signature in Task 3 Step 4 matches its one call site in Task 3 Step 5.
