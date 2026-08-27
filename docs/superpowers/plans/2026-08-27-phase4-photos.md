# Phase 4 — Progress Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user attach one private progress photo per day, stored in a private R2 bucket, visible only to the uploader — on the Today screen for the current day and as a timeline strip on the History screen.

**Architecture:** One new `photos` table (already in the spec's schema) plus a new R2 bucket binding `PHOTOS`. A new Hono sub-router `src/api/photos.ts` handles upload (`POST /api/photos`, multipart, server decides the date), listing (`GET /api/photos` → dates only), and owner-only serving (`GET /api/photos/:date` → JPEG bytes; another user's date simply 404s because the query filters by `user.id`). The client resizes to ≤1080 px JPEG q0.8 in a canvas before upload. No public URLs, no signed links.

**Tech Stack:** Cloudflare Workers, Hono, D1, R2, Zod (param regex only here), React 19 + Vite + Tailwind, Vitest + `cloudflare:test` (`SELF.fetch` against local D1 + miniflare R2).

**Spec:** `docs/superpowers/specs/2026-08-26-75hard-family-tracker-design.md` — section 9 "Photos", section 4 schema (`photos` table), section 6 "API" (`POST /api/photos`, `GET /api/photos/:date`), section 12 "Build order" item 4.

## Global Constraints

- All dates are `Asia/Kolkata`, computed via `src/lib/dates.ts` (`todayIST`). Never trust the device clock or a client-supplied date for which day a photo belongs to — the server sets it, exactly as `src/api/food.ts` does for the diary.
- Every route lives behind `requireAuth` (wired globally in `src/api/router.ts` for everything except `/api/auth/*` and `/api/health`) — the new router needs no auth code of its own.
- Ownership is the `WHERE` clause: every `photos` query filters by `user.id`. There is no separate permission check — a non-owner's request for a date they don't own returns 404, which is the spec's requirement ("returns 404 otherwise… a photo cannot leak by URL sharing").
- No public R2 access, no signed URLs. Bytes are served only through `GET /api/photos/:date` with `Cache-Control: private, no-store`.
- R2 object key is deterministic: `{userId}/{runId}/{date}.jpg` (spec §9).
- Re-upload for a date that already has a photo **replaces** it (overwrites the R2 object, refreshes the row) — the `UNIQUE(user_id, date)` index enforces one per date.
- A photo can only be attached to **today** and only while the user has an **active run**. Backfilling yesterday during the grace window is out of scope for v1.
- Client always sends `image/jpeg`. The server rejects anything else (415) and anything over 1 MB (413). The client target is ~200 KB.
- No emoji as icons — Lucide only.
- Never run `wrangler deploy`, `wrangler r2 bucket create`, `d1 create`, or any `--remote` command. The remote bucket is a manual pre-flight step for the maintainer (see "Deferred / manual" below).
- No end-to-end browser tests. Backend behaviour is covered by Vitest integration tests against `SELF.fetch` + local D1 + miniflare R2, following `tests/history-api.test.ts`'s structure. Frontend screens have no automated tests in this repo (none exist for Today, Food, or Family) — verify manually via `npm run dev`, as Phases 2 and 3 did. Pure helper functions do get a unit test.

---

## File Structure

| File | Responsibility |
|---|---|
| `wrangler.jsonc` (modify) | Add the `r2_buckets` binding `PHOTOS` → `75hard-photos`. |
| `vitest.config.ts` (modify) | Add `r2Buckets: ['PHOTOS']` to the miniflare block so tests get a simulated bucket. |
| `src/worker.ts` (modify) | Add `PHOTOS: R2Bucket` to the `Env` interface. |
| `src/db/photos.ts` (new) | Three functions: `getPhoto`, `listPhotoDates`, `upsertPhoto`. The only module that touches the `photos` table. |
| `src/api/photos.ts` (new) | The `photos` sub-router: `GET /`, `POST /`, `GET /:date`. Shapes DB rows and R2 objects into HTTP responses; owns all validation. |
| `src/api/router.ts` (modify) | Mount `photos` at `/photos`. |
| `tests/photos-api.test.ts` (new) | Upload → row + object; owner serve; non-owner 404; replace; no-active-run 400; missing-date 404; non-jpeg 415. |
| `web/lib/image.ts` (new) | `fitDimensions` (pure, tested) + `resizeToJpeg` (canvas, browser-only). |
| `tests/image.test.ts` (new) | Unit tests for `fitDimensions`. |
| `web/api.ts` (modify) | `Photo` type; `photos()`, `uploadPhoto(blob)` (raw `fetch`, no JSON content-type), `photoUrl(date)`. |
| `web/components/PhotoOverlay.tsx` (new) | Full-screen tap-to-dismiss image viewer, used by both Today and History. |
| `web/components/PhotoTile.tsx` (new) | Today's photo affordance: capture / thumbnail / replace / view, with inline error + busy state. |
| `web/screens/Today.tsx` (modify) | Fetch the photo-date list in `load()`; render `<PhotoTile>` below the goal rows. |
| `web/screens/History.tsx` (modify) | Fetch the photo-date list; render a horizontal thumbnail strip at the top; tap opens `<PhotoOverlay>`. |

---

## Task 1: R2 binding + config wiring

> **Plan correction (controller ruling, preflight):** `migrations/0001_init.sql`
> already creates the `photos` table (Phase 1 built every table up front,
> including `push_subs`). Do NOT add a `0003_photos.sql` migration — a second
> `CREATE TABLE photos` breaks incremental apply on every DB that already ran
> 0001 (local dev + remote). No migration changes in this phase. The smoke
> test still asserts the table exists (it does, from 0001).

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `vitest.config.ts`
- Modify: `src/worker.ts:4-7` (the `Env` interface)
- Test: `tests/photos-api.test.ts` (create with one smoke test; grows in Task 3)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Migration creates table `photos(id TEXT PK, user_id TEXT, run_id TEXT, date TEXT, r2_key TEXT, at INTEGER, UNIQUE(user_id,date))`.
  - `Env` gains `PHOTOS: R2Bucket`.
  - Test binding `env.PHOTOS` is a working R2 bucket in Vitest.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0003_photos.sql
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
```

- [ ] **Step 2: Add the R2 binding to `wrangler.jsonc`**

Add a top-level `"r2_buckets"` array, as a sibling of `"d1_databases"`:

```jsonc
  "r2_buckets": [
    { "binding": "PHOTOS", "bucket_name": "75hard-photos" }
  ],
```

- [ ] **Step 3: Add the simulated bucket to `vitest.config.ts`**

In the `miniflare` object, alongside `d1Databases`:

```typescript
        miniflare: {
          d1Databases: ['DB'],
          r2Buckets: ['PHOTOS'],
          bindings: { MIGRATIONS: migrations },
        },
```

- [ ] **Step 4: Add `PHOTOS` to the `Env` interface**

In `src/worker.ts`:

```typescript
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PHOTOS: R2Bucket;
}
```

- [ ] **Step 5: Write the smoke test**

```typescript
// tests/photos-api.test.ts
import { env, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll } from 'vitest';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

it('has a photos table and an R2 bucket bound', async () => {
  const row = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='photos'",
  ).first<{ name: string }>();
  expect(row?.name).toBe('photos');

  await env.PHOTOS.put('probe', 'hello');
  const obj = await env.PHOTOS.get('probe');
  expect(await obj?.text()).toBe('hello');
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run tests/photos-api.test.ts`
Expected: PASS. (`npm run pretest` runs `tsc --noEmit` — the `Env` change must typecheck.)

- [ ] **Step 7: Apply the migration locally**

Run: `npm run migrate:local`
Expected: `0003_photos.sql` applied, no error.

- [ ] **Step 8: Commit**

```bash
git add migrations/0003_photos.sql wrangler.jsonc vitest.config.ts src/worker.ts tests/photos-api.test.ts
git commit -m "feat: photos table and private R2 bucket binding"
```

---

## Task 2: `src/db/photos.ts` — the data layer

**Files:**
- Create: `src/db/photos.ts`
- Test: extend `tests/photos-api.test.ts`

**Interfaces:**
- Consumes: `newId(): string` from `src/lib/ids.ts`.
- Produces:
  - `type PhotoRow = { id: string; user_id: string; run_id: string; date: string; r2_key: string; at: number }`
  - `getPhoto(db: D1Database, userId: string, date: string): Promise<PhotoRow | null>`
  - `listPhotoDates(db: D1Database, userId: string): Promise<string[]>` — newest date first
  - `upsertPhoto(db: D1Database, userId: string, runId: string, date: string, r2Key: string, at: number): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `tests/photos-api.test.ts`:

```typescript
it('upsertPhoto inserts then replaces on the same (user, date)', async () => {
  const { upsertPhoto, getPhoto, listPhotoDates } = await import('../src/db/photos');
  await env.DB.prepare('DELETE FROM photos').run();

  await upsertPhoto(env.DB, 'u1', 'r1', '2026-08-01', 'u1/r1/2026-08-01.jpg', 1000);
  await upsertPhoto(env.DB, 'u1', 'r1', '2026-08-03', 'u1/r1/2026-08-03.jpg', 3000);
  // same date again — must not create a second row
  await upsertPhoto(env.DB, 'u1', 'r1', '2026-08-01', 'u1/r1/2026-08-01.jpg', 9999);

  const dates = await listPhotoDates(env.DB, 'u1');
  expect(dates).toEqual(['2026-08-03', '2026-08-01']);

  const row = await getPhoto(env.DB, 'u1', '2026-08-01');
  expect(row?.at).toBe(9999);

  expect(await getPhoto(env.DB, 'u2', '2026-08-01')).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/photos-api.test.ts`
Expected: FAIL — `Cannot find module '../src/db/photos'`.

- [ ] **Step 3: Implement `src/db/photos.ts`**

```typescript
import { newId } from '../lib/ids';

export type PhotoRow = {
  id: string; user_id: string; run_id: string;
  date: string; r2_key: string; at: number;
};

export function getPhoto(
  db: D1Database, userId: string, date: string,
): Promise<PhotoRow | null> {
  return db.prepare('SELECT * FROM photos WHERE user_id = ? AND date = ?')
    .bind(userId, date).first<PhotoRow>();
}

/** Every date this user has a photo for, newest first. Dates only — the
 *  bytes are fetched one at a time through GET /api/photos/:date. */
export async function listPhotoDates(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db.prepare(
    'SELECT date FROM photos WHERE user_id = ? ORDER BY date DESC',
  ).bind(userId).all<{ date: string }>();
  return results.map((r) => r.date);
}

/** Record (or refresh) the pointer to this user's photo for `date`. The
 *  caller writes the R2 object first; this only touches the row. The key is
 *  deterministic, so ON CONFLICT just refreshes `at` and `run_id` — a repeat
 *  upload overwrote the same object. */
export async function upsertPhoto(
  db: D1Database, userId: string, runId: string,
  date: string, r2Key: string, at: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO photos (id,user_id,run_id,date,r2_key,at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id,date)
       DO UPDATE SET at = excluded.at, run_id = excluded.run_id, r2_key = excluded.r2_key`,
  ).bind(newId(), userId, runId, date, r2Key, at).run();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/photos-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/photos.ts tests/photos-api.test.ts
git commit -m "feat: photos data layer (get, list dates, upsert)"
```

---

## Task 3: `src/api/photos.ts` — upload, list, serve

**Files:**
- Create: `src/api/photos.ts`
- Modify: `src/api/router.ts:1-29`
- Test: extend `tests/photos-api.test.ts`

**Interfaces:**
- Consumes: `todayIST(now: Date): string` from `src/lib/dates.ts`; `getActiveRun(db, userId): Promise<RunRow | null>` from `src/db/runs.ts`; `getPhoto`, `listPhotoDates`, `upsertPhoto` from `src/db/photos.ts`; `type App` from `src/api/middleware.ts`.
- Produces: the `photos` Hono router. HTTP contract (Task 5's frontend types must match):
  - `GET /api/photos` → `200 [{ "date": "YYYY-MM-DD" }]` (newest first)
  - `POST /api/photos` → multipart form, field `photo` (a JPEG File). → `200 { "date": "YYYY-MM-DD" }`. `400` no active run / no file. `415` not `image/jpeg`. `413` over 1 MB.
  - `GET /api/photos/:date` → `200` JPEG bytes, `content-type: image/jpeg`, `cache-control: private, no-store`. `400` malformed date. `404` no photo for that (user, date) — including another user's date.

- [ ] **Step 1: Write the failing tests**

Replace the top of `tests/photos-api.test.ts` so it has the full harness (two seeded users, login cookie for `u1`), keeping the two tests already written, and add the endpoint tests:

```typescript
// tests/photos-api.test.ts
import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { hashPin } from '../src/lib/password';

beforeAll(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

let cookie = '';
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM photos'), env.DB.prepare('DELETE FROM strikes'),
    env.DB.prepare('DELETE FROM progress'), env.DB.prepare('DELETE FROM days'),
    env.DB.prepare('DELETE FROM goals'), env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users'),
  ]);
  const { hash, salt } = await hashPin('1234');
  for (const [id, name, color] of [['u1', 'Utkarsh', '#EA580C'], ['u2', 'Priya', '#22C55E']]) {
    await env.DB.prepare(
      'INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, name, color, hash, salt, Date.now()).run();
  }
  const login = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', pin: '1234' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

const jpeg = (byte = 1) => new File([new Uint8Array(64).fill(byte)], 'p.jpg', { type: 'image/jpeg' });

async function onboard() {
  await SELF.fetch('https://example.com/api/onboarding', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ variant: 'hard', startDate: today() }),
  });
}

async function upload(file: File, c = cookie) {
  const body = new FormData();
  body.append('photo', file);
  return SELF.fetch('https://example.com/api/photos', { method: 'POST', headers: { cookie: c }, body });
}

it('rejects upload with no active run', async () => {
  const res = await upload(jpeg());
  expect(res.status).toBe(400);
});

it('uploads, lists the date, and serves the bytes back to the owner', async () => {
  await onboard();
  const post = await upload(jpeg(7));
  expect(post.status).toBe(200);
  expect(await post.json()).toEqual({ date: today() });

  const list = await SELF.fetch('https://example.com/api/photos', { headers: { cookie } });
  expect(await list.json()).toEqual([{ date: today() }]);

  const get = await SELF.fetch(`https://example.com/api/photos/${today()}`, { headers: { cookie } });
  expect(get.status).toBe(200);
  expect(get.headers.get('content-type')).toBe('image/jpeg');
  expect(get.headers.get('cache-control')).toBe('private, no-store');
  expect(new Uint8Array(await get.arrayBuffer())[0]).toBe(7);
});

it('replaces the photo on a second upload for the same day', async () => {
  await onboard();
  await upload(jpeg(1));
  await upload(jpeg(2));

  const list = await SELF.fetch('https://example.com/api/photos', { headers: { cookie } });
  expect(await list.json()).toEqual([{ date: today() }]); // still one

  const get = await SELF.fetch(`https://example.com/api/photos/${today()}`, { headers: { cookie } });
  expect(new Uint8Array(await get.arrayBuffer())[0]).toBe(2);
});

it("returns 404 for another user's photo, with no leak", async () => {
  await onboard();
  await upload(jpeg());

  const u2 = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u2', pin: '1234' }),
  });
  const u2cookie = (u2.headers.get('set-cookie') ?? '').split(';')[0]!;

  const res = await SELF.fetch(`https://example.com/api/photos/${today()}`, { headers: { cookie: u2cookie } });
  expect(res.status).toBe(404);
});

it('404s a date with no photo, 400s a malformed date', async () => {
  await onboard();
  expect((await SELF.fetch('https://example.com/api/photos/2026-01-01', { headers: { cookie } })).status).toBe(404);
  expect((await SELF.fetch('https://example.com/api/photos/nope', { headers: { cookie } })).status).toBe(400);
});

it('rejects a non-jpeg upload with 415', async () => {
  await onboard();
  const body = new FormData();
  body.append('photo', new File([new Uint8Array(8)], 'p.png', { type: 'image/png' }));
  const res = await SELF.fetch('https://example.com/api/photos', { method: 'POST', headers: { cookie }, body });
  expect(res.status).toBe(415);
});
```

(Delete the two Task-1/Task-2 `it(...)` blocks that used the old bare-`beforeAll` harness only if they no longer compile against the new `beforeEach` — the table/bucket smoke test and the `upsertPhoto` test can stay; move them below the harness. Keep whichever still pass.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/photos-api.test.ts`
Expected: FAIL — routes 404 (router has no `/photos` mount yet).

- [ ] **Step 3: Implement `src/api/photos.ts`**

```typescript
import { Hono } from 'hono';
import { todayIST } from '../lib/dates';
import { getActiveRun } from '../db/runs';
import { getPhoto, listPhotoDates, upsertPhoto } from '../db/photos';
import type { App } from './middleware';

export const photos = new Hono<App>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BYTES = 1_000_000;

photos.get('/', async (c) => {
  const dates = await listPhotoDates(c.env.DB, c.get('user').id);
  return c.json(dates.map((date) => ({ date })));
});

photos.post('/', async (c) => {
  const user = c.get('user');
  // A photo belongs to a run day. No run, nothing to attach it to.
  const run = await getActiveRun(c.env.DB, user.id);
  if (!run) return c.json({ error: 'no active run' }, 400);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get('photo');
  if (!(file instanceof File)) return c.json({ error: 'bad request' }, 400);
  if (file.type !== 'image/jpeg') return c.json({ error: 'must be a jpeg' }, 415);
  if (file.size > MAX_BYTES) return c.json({ error: 'too large' }, 413);

  // Server owns the date — never the client's clock (see food.ts).
  const now = new Date();
  const date = todayIST(now);
  const key = `${user.id}/${run.id}/${date}.jpg`;

  // Object first, then the row. A failed put leaves no row; a stray object
  // from a later-failed insert is harmless and is overwritten next upload.
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  await upsertPhoto(c.env.DB, user.id, run.id, date, key, now.getTime());
  return c.json({ date });
});

photos.get('/:date', async (c) => {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);

  // Ownership is the WHERE clause: another user's date is simply not found.
  const row = await getPhoto(c.env.DB, c.get('user').id, date);
  if (!row) return c.json({ error: 'not found' }, 404);

  const obj = await c.env.PHOTOS.get(row.r2_key);
  if (!obj) return c.json({ error: 'not found' }, 404);

  return new Response(obj.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' },
  });
});
```

- [ ] **Step 4: Mount the router**

In `src/api/router.ts`, add the import next to the others and the route next to `history`:

```typescript
import { photos } from './photos';
// ...
api.route('/history', history); // GET /api/history
api.route('/photos', photos);   // GET/POST /api/photos, GET /api/photos/:date
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/photos-api.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test`
Expected: PASS. No regression in the other suites.

- [ ] **Step 7: Commit**

```bash
git add src/api/photos.ts src/api/router.ts tests/photos-api.test.ts
git commit -m "feat: POST/GET /api/photos — private per-day progress photos"
```

---

## Task 4: `web/lib/image.ts` — client-side resize + `web/api.ts` client

**Files:**
- Create: `web/lib/image.ts`
- Create: `tests/image.test.ts`
- Modify: `web/api.ts:29-34` (types) and `web/api.ts:93-99` (the `api` object)

**Interfaces:**
- Consumes: `ApiError` from `web/api.ts`.
- Produces:
  - `fitDimensions(w: number, h: number, max: number): { w: number; h: number }` — never upscales
  - `resizeToJpeg(file: File, max?: number, quality?: number): Promise<Blob>` — default `max = 1080`, `quality = 0.8`
  - `web/api.ts`: `type Photo = { date: string }`; `api.photos(): Promise<Photo[]>`; `api.uploadPhoto(blob: Blob): Promise<{ date: string }>`; `api.photoUrl(date: string): string`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/image.test.ts
import { it, expect } from 'vitest';
import { fitDimensions } from '../web/lib/image';

it('never upscales an image smaller than max', () => {
  expect(fitDimensions(800, 600, 1080)).toEqual({ w: 800, h: 600 });
});

it('scales a landscape image so the long edge is max, keeping aspect', () => {
  expect(fitDimensions(4000, 3000, 1080)).toEqual({ w: 1080, h: 810 });
});

it('scales a portrait image the same way', () => {
  expect(fitDimensions(3000, 4000, 1080)).toEqual({ w: 810, h: 1080 });
});

it('is a no-op exactly at the limit', () => {
  expect(fitDimensions(1080, 500, 1080)).toEqual({ w: 1080, h: 500 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/image.test.ts`
Expected: FAIL — `Cannot find module '../web/lib/image'`.

- [ ] **Step 3: Implement `web/lib/image.ts`**

```typescript
/** Scale (w, h) so the longer edge is at most `max`, preserving aspect
 *  ratio. Never upscales. Pure — the tested half of the resize. */
export function fitDimensions(
  w: number, h: number, max: number,
): { w: number; h: number } {
  const longEdge = Math.max(w, h);
  if (longEdge <= max) return { w, h };
  const scale = max / longEdge;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** Decode `file`, downscale to <= `max` px on the long edge, re-encode JPEG
 *  at `quality`. Browser-only (canvas). The spec's ~200 KB target comes from
 *  max=1080 / quality=0.8 on a typical phone photo. */
export async function resizeToJpeg(
  file: File, max = 1080, quality = 0.8,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { w, h } = fitDimensions(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is not supported on this device');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('could not encode the photo'))),
      'image/jpeg',
      quality,
    );
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/image.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the client methods to `web/api.ts`**

Add the type near the other exported types (after `SlipResult`):

```typescript
export type Photo = { date: string };
```

Add to the `api` object, after `history:` :

```typescript
  photos: () => call<Photo[]>('/api/photos'),
  // multipart — must NOT go through call(), which forces application/json.
  // Letting fetch set its own multipart boundary is the whole point.
  uploadPhoto: async (blob: Blob): Promise<{ date: string }> => {
    const body = new FormData();
    body.append('photo', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    const res = await fetch('/api/photos', { method: 'POST', body });
    if (!res.ok) {
      const j = await res.json<{ error?: string }>().catch(() => ({}) as { error?: string });
      throw new ApiError(res.status, j.error ?? res.statusText);
    }
    return res.json<{ date: string }>();
  },
  photoUrl: (date: string) => `/api/photos/${date}`,
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/lib/image.ts tests/image.test.ts web/api.ts
git commit -m "feat: client-side photo resize and photos API client"
```

---

## Task 5: `PhotoOverlay` + `PhotoTile`, wired into Today

**Files:**
- Create: `web/components/PhotoOverlay.tsx`
- Create: `web/components/PhotoTile.tsx`
- Modify: `web/screens/Today.tsx`

**Interfaces:**
- Consumes: `api.photos`, `api.uploadPhoto`, `api.photoUrl`, `ApiError` from `web/api.ts`; `resizeToJpeg` from `web/lib/image.ts`.
- Produces:
  - `<PhotoOverlay src={string} alt={string} onClose={() => void} />`
  - `<PhotoTile date={string} hasPhoto={boolean} onChange={() => void} />` — `onChange` fires after a successful upload so the parent can refetch.

- [ ] **Step 1: Implement `web/components/PhotoOverlay.tsx`**

```tsx
/** Full-screen, tap-anywhere-to-dismiss image viewer. Used by Today and
 *  History. No routing — it is pure local state in the caller. */
export function PhotoOverlay({
  src, alt, onClose,
}: { src: string; alt: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label={alt}
      className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4"
    >
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg" />
    </div>
  );
}
```

- [ ] **Step 2: Implement `web/components/PhotoTile.tsx`**

```tsx
import { useRef, useState, type ChangeEvent } from 'react';
import { Camera } from 'lucide-react';
import { api, ApiError } from '../api';
import { resizeToJpeg } from '../lib/image';
import { PhotoOverlay } from './PhotoOverlay';

export function PhotoTile({
  date, hasPhoto, onChange,
}: { date: string; hasPhoto: boolean; onChange: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  // Bump on replace so the <img> re-requests instead of showing the cached one.
  const [v, setV] = useState(0);
  const src = `${api.photoUrl(date)}?v=${v}`;

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked later
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const blob = await resizeToJpeg(file);
      await api.uploadPhoto(blob);
      setV((n) => n + 1);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the photo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <div className="display text-xs text-[var(--color-muted)]">Progress photo</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={pick}
      />

      {hasPhoto ? (
        <>
          <button onClick={() => setFull(true)} className="mt-2 block w-full" aria-label="View progress photo">
            <img src={src} alt={`Progress photo for ${date}`} className="h-48 w-full rounded-xl object-cover" />
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-2 display text-xs text-[var(--color-primary)]"
          >
            {busy ? 'Uploading…' : 'Replace'}
          </button>
        </>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-2 flex h-32 w-full items-center justify-center gap-2 rounded-xl
                     border border-dashed border-[var(--color-border)] text-[var(--color-muted)]"
        >
          <Camera size={18} aria-hidden />
          {busy ? 'Uploading…' : 'Add progress photo'}
        </button>
      )}

      {error && <p role="alert" className="mt-1 text-sm text-[var(--color-destructive)]">{error}</p>}

      {full && (
        <PhotoOverlay src={src} alt={`Progress photo for ${date}`} onClose={() => setFull(false)} />
      )}
    </section>
  );
}
```

- [ ] **Step 3: Wire it into `web/screens/Today.tsx`**

Add the import:

```tsx
import { PhotoTile } from '../components/PhotoTile';
```

Add state next to the others (near line 33):

```tsx
  const [photoDates, setPhotoDates] = useState<string[]>([]);
```

In `load()`, after `setDay(d);` (the successful-day branch, ~line 57), fetch the list. It must not break the screen if it fails — a missing photo list is cosmetic:

```tsx
      try {
        setPhotoDates(await api.photos());
      } catch {
        setPhotoDates([]);
      }
```

Render the tile inside `<main>`, immediately after the closing `</div>` of the goal-rows block (after line 145), before `</main>`:

```tsx
        <PhotoTile
          date={serverToday}
          hasPhoto={photoDates.includes(serverToday)}
          onChange={() => { void load(); }}
        />
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. In the browser (375 px width / mobile emulation):
1. Log in, reach Today with an active run.
2. "Add progress photo" → pick any image → it uploads and a thumbnail appears (no full reload).
3. Tap the thumbnail → full-screen overlay → tap to dismiss.
4. "Replace" → pick a different image → thumbnail updates to the new one.
5. Reload the page → thumbnail persists.
6. DevTools Network: the `GET /api/photos/<today>` response is `image/jpeg`, `cache-control: private, no-store`, and roughly 100–300 KB for a large source photo (confirms the resize ran).

- [ ] **Step 6: Commit**

```bash
git add web/components/PhotoOverlay.tsx web/components/PhotoTile.tsx web/screens/Today.tsx
git commit -m "feat: progress photo capture on the Today screen"
```

---

## Task 6: Photo timeline strip on the History screen

**Files:**
- Modify: `web/screens/History.tsx`

**Interfaces:**
- Consumes: `api.photos`, `api.photoUrl` from `web/api.ts`; `PhotoOverlay` from `web/components/PhotoOverlay.tsx`.
- Produces: nothing new — a UI addition only.

- [ ] **Step 1: Add the strip to `web/screens/History.tsx`**

Add imports:

```tsx
import { api, ApiError, type Run, type Photo } from '../api';
import { PhotoOverlay } from '../components/PhotoOverlay';
```

Add state next to `runs`/`error`:

```tsx
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [openDate, setOpenDate] = useState<string | null>(null);
```

In the existing `useEffect`, after the `api.history()` call resolves (or in its own `.then`), also load photos — failure here is cosmetic, swallow it:

```tsx
    api.photos().then(setPhotos).catch(() => setPhotos([]));
```

Render the strip between the `<h1>` and the `error` paragraph. `api.photos()` already returns newest-first:

```tsx
        {photos.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {photos.map((p) => (
              <button
                key={p.date}
                onClick={() => setOpenDate(p.date)}
                className="shrink-0"
                aria-label={`Progress photo from ${p.date}`}
              >
                <img
                  src={api.photoUrl(p.date)}
                  alt={`Progress photo from ${p.date}`}
                  className="h-20 w-20 rounded-lg object-cover"
                />
                <div className="mt-1 text-center text-[10px] text-[var(--color-muted)]">{p.date}</div>
              </button>
            ))}
          </div>
        )}
```

Render the overlay just before the closing `</>`:

```tsx
        {openDate && (
          <PhotoOverlay
            src={api.photoUrl(openDate)}
            alt={`Progress photo from ${openDate}`}
            onClose={() => setOpenDate(null)}
          />
        )}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`.
1. With at least one photo uploaded (from Task 5), open **Me → Run history**.
2. A horizontal strip of square thumbnails appears at the top, newest first, each labelled with its date.
3. The strip scrolls horizontally on a 375 px viewport; the page itself does not scroll sideways.
4. Tap a thumbnail → full-screen overlay → tap to dismiss.
5. A second user logging in sees only their own photos here (none, if they uploaded none).

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/screens/History.tsx
git commit -m "feat: progress photo timeline strip on the History screen"
```

---

## Deferred / manual (not part of this plan's tasks)

- **Create the remote R2 bucket** before the first deploy that includes this phase:
  `wrangler r2 bucket create 75hard-photos` — must match `bucket_name` in `wrangler.jsonc`. The maintainer runs this; agents must not.
- **README** — add a Phase 4 line under the phase list (`- **Phase 4** — Progress photos …` already exists as a forward-looking bullet; change "planned" framing to shipped if the surrounding text implies it).
- **Backfilling a photo for yesterday** during the grace window — deliberately out of scope for v1 (spec §9 is silent; §7 Today's grace window is about goal edits).
- **Push / PWA** — Phase 5.

---

## Self-Review

**Spec coverage (§9 Photos):**
- "Private R2 bucket, no public access" → Task 1 binding; Task 3 serves only through the authed route with `private, no-store`. ✓
- "client resizes to a maximum of 1080 px on the long edge and encodes JPEG at quality 0.8" → Task 4 `resizeToJpeg(file, 1080, 0.8)`. ✓
- "Worker streams the body to R2 under `{userId}/{runId}/{date}.jpg` and writes the `photos` row" → Task 3 `POST /` (`key = ${user.id}/${run.id}/${date}.jpg`, then `upsertPhoto`). ✓
- "Serving: only through `GET /api/photos/:date`, which checks `photo.user_id === session.user_id` and returns 404 otherwise" → Task 3 `GET /:date` (`getPhoto` filters by `user.id`; `null` → 404). Test: "returns 404 for another user's photo". ✓
- "no public URLs and no signed links" → only `env.PHOTOS.get` server-side; response streams bytes, never a URL. ✓
- Schema (§4 `photos` table) → Task 1 migration, columns and `UNIQUE(user_id,date)` verbatim. ✓
- API list (§6): `POST /api/photos` multipart, `GET /api/photos/:date` → Task 3. `GET /api/photos` (date list) is an addition needed by the two UI surfaces; it exposes only dates the caller owns. ✓
- Build order §12 item 4 "Photos — R2 upload, private serving" → this plan. ✓
- Access-control integration test ("user B gets a 404 for user A's photo", §11) → Task 3 test. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `PhotoRow` (snake_case, DB) vs `Photo = { date }` (frontend, matches `GET /api/photos` JSON). `upsertPhoto(db, userId, runId, date, r2Key, at)` — same arg order in Task 2 definition, Task 2 test, and Task 3 call site. `fitDimensions` / `resizeToJpeg` names match across Task 4 and Task 5. `PhotoTile` props `{ date, hasPhoto, onChange }` match between Task 5 definition and the Task 5 Today wiring. `PhotoOverlay` props `{ src, alt, onClose }` match across Tasks 5 and 6.

**Scope:** one subsystem, six tasks, each ending on an independently testable deliverable. No decomposition needed.
