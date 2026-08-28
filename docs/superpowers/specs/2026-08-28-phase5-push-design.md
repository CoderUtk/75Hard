# Phase 5a — Push Notifications

**Date:** 2026-08-28
**Status:** Approved design, ready for implementation planning

Web-push reminders sent straight from the Worker. Two scheduled sends: a nightly
nudge for users with an incomplete day, and a milestone ping to the rest of the
family when someone passes Day 25, 50, or 75.

PWA install (manifest, icons, `vite-plugin-pwa`, offline shell) is **Phase 5b** —
deliberately not in this design. The only PWA-adjacent artefact here is a bare
service worker, needed because push cannot work without one.

---

## 1. Decisions

Settled during design. Treat as constraints.

| Area | Decision |
|---|---|
| Push transport | VAPID web-push direct from the Worker. No third-party push service. |
| Payload crypto | A `webcrypto`-based web-push library (RFC 8291 aes128gcm). Not hand-rolled. Not the Node-only `web-push` package. |
| Library pick | Confirmed in Task 1 (spike). Candidate: `webpush-webcrypto`. Must run on `workerd` with no Node polyfills beyond `nodejs_compat`. |
| Service worker | Hand-written `web/sw.js`, ~25 lines, no Workbox, no build step. Served as a static asset from `web/public/`. |
| Nudge recipients | Users with an active run **and** ≥1 push subscription, whose current day has ≥1 incomplete goal. |
| Milestone recipients | **Every** other user with a push subscription — regardless of their own run state (active, failed, done, never started). Not the achiever. |
| Milestone days | 25, 50, 75. Fired from inside the noon lock pass, only for a day that just transitioned to `passed`. |
| Subscription identity | `push_subs.endpoint` is already `UNIQUE`. Subscribe = upsert on endpoint. One row per browser install. |
| Dead subscriptions | A send returning HTTP 404 or 410 deletes that `push_subs` row in the same pass. |
| VAPID keys | Worker secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Generated in Task 1, set by the operator with `wrangler secret put`. |
| Missing secrets | `/api/push/subscribe` returns 503; cron sends become logged no-ops. Local dev without secrets stays fully functional. |
| iOS | Safari delivers push only to a Home-Screen-installed app. The Me tab states this in plain language next to the toggle. No attempt to detect or work around it. |
| Notification click | Focus an existing app tab if one is open, else open `/today`. |

### Explicitly not built

- **PWA manifest / install / icons / offline shell** — Phase 5b.
- **In-app notification history or a bell menu** — the OS notification tray is the history.
- **Per-notification-type toggles** — one switch controls all push. Add granularity only if asked.
- **Retry/backoff on a failed send** — a missed nudge is a missed nudge; the next day's fires normally. Milestones are one-shot.
- **Quiet hours / timezone per user** — the app is fixed to `Asia/Kolkata` everywhere already.
- **Web-push crypto unit tests with RFC vectors** — the spike proves real delivery; a vector harness is not worth its weight.

---

## 2. Module layout

```
src/push/
  vapid.ts       ES256-sign the VAPID JWT for the Authorization header. WebCrypto.
  send.ts        encrypt a payload + POST to the endpoint. Returns 'ok' | 'prune' | 'error'.
  messages.ts    pure. nudgeText(dayNumber, goalsLeft) / milestoneText(name, dayNumber).
                 No I/O. Fully unit-tested.
src/db/push.ts   push_subs queries. Ownership boundary is AND user_id = ? on delete.
src/api/push.ts  POST /subscribe, DELETE /subscribe, GET /vapid-public-key
src/services/
  nudge.ts       21:00 IST pass: pick users, build text, send, prune.
  (grading.ts)   gains a milestone hook — see §6.
```

`src/push/` imports only `src/db/` and the chosen library. `src/lib/` still imports
nothing. The pure/impure split from the rest of the codebase holds: `messages.ts` is
pure, everything touching crypto or the network is in `vapid.ts` / `send.ts`.

`Env` (in `src/worker.ts`) gains:

```ts
VAPID_PUBLIC_KEY?: string;
VAPID_PRIVATE_KEY?: string;
VAPID_SUBJECT?: string;
```

All optional — their absence is a defined, tested state (§1, "Missing secrets").

---

## 3. Database

No migration. `push_subs` already exists from `migrations/0001_init.sql`:

```sql
CREATE TABLE push_subs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

`src/db/push.ts`:

| Function | Query |
|---|---|
| `upsertSub(db, userId, sub)` | `INSERT ... ON CONFLICT(endpoint) DO UPDATE SET user_id, p256dh, auth` — a re-subscribe from the same browser, possibly by a different family member, rebinds the row. |
| `deleteSub(db, userId, endpoint)` | `DELETE ... WHERE endpoint = ? AND user_id = ?` — ownership boundary; you cannot delete another user's row. |
| `deleteSubByEndpoint(db, endpoint)` | `DELETE ... WHERE endpoint = ?` — used by the prune path after a 404/410; the push service, not a user, is the authority here. |
| `listSubsForUser(db, userId)` | all rows for one user (nudge send). |
| `listSubsExcept(db, userId)` | all rows whose `user_id != ?` (milestone send). |
| `usersToNudge(db)` | `user_id`s with `status='active'` run that also have ≥1 sub. Text/goal-count is computed per user by the caller, not in SQL. |

Row type `PushSubRow = { id, user_id, endpoint, p256dh, auth, created_at }`.

---

## 4. HTTP API

All under the global `requireAuth` (session cookie), except nothing here is exempt.

```
POST   /api/push/subscribe
       body { endpoint: string, keys: { p256dh: string, auth: string } }
       Zod-validated. 503 if VAPID secrets absent. 200 { ok: true } on upsert.

DELETE /api/push/subscribe
       body { endpoint: string }
       200 { ok: true } whether or not a row existed (idempotent).

GET    /api/push/vapid-public-key
       200 { key: string }  — the base64url public key the client feeds to
       pushManager.subscribe. 503 if absent.
```

Wired in `src/api/router.ts`: `api.route('/push', push)` after the `photos` route.

The public key could be folded into `GET /api/me`, but a dedicated endpoint keeps the
`me` payload stable and the subscribe flow reads better. One extra request, once,
when the user first enables reminders.

---

## 5. Nudge — 21:00 IST

`src/services/nudge.ts`, `runNudge(db, env, now)`:

1. `usersToNudge(db)` → candidate `user_id`s.
2. For each: materialise today's day row via the existing `ensureDay` path, load
   progress with `getProgress`, grade with `gradeDay` (all from `src/services/grading.ts`
   / `src/lib/rules.ts` — the same logic `GET /api/me` renders). Count incomplete goals.
3. `goalsLeft === 0` → skip. Otherwise `messages.nudgeText(dayNumber, goalsLeft)` →
   `"Day 12 — 2 goals left."` (`"1 goal left."` singular).
4. `listSubsForUser` → `send()` to each, `Promise.allSettled`.
5. Any `'prune'` result → `deleteSubByEndpoint`.

Called from `src/worker.ts` `scheduled()` under `event.cron === '30 15 * * *'`, wrapped
in `ctx.waitUntil(runNudge(...).catch(log))`. The `30 15 * * *` trigger is already in
`wrangler.jsonc`; `scheduled()` already has the placeholder comment for it.

`ensureDay` creating today's row at 21:00 is harmless — the row is created on the
user's first app open anyway, and its goal snapshot is taken from current active goals
either way.

---

## 6. Milestone — inside the noon lock

`catchUpGrading` in `src/services/grading.ts` already detects the day that just passed
and has its `day_number`. Today it does nothing on a pass except possibly complete the
run at Day 75.

Add: when a day's grade transitions it to `passed` (not on a re-grade of an
already-locked day — the `lockDay` claim guard already gives us "this pass is the one
that locked it") and `day.day_number` is 25, 50, or 75:

- collect the achiever's `name` (already have `userId`; one `getUser` or pass it through)
- `listSubsExcept(db, userId)` → `messages.milestoneText(name, dayNumber)` →
  `"Utkarsh reached Day 50 🔥"`
- `send()` to each, `Promise.allSettled`, prune on 404/410

This runs for both cron-driven grading and the request-path backstop. It must be
idempotent-safe: it fires only on the pass that wins the `lockDay` claim, and
`lockDay` is a single-winner `UPDATE ... WHERE locked_at IS NULL`. A second pass over
the same day never re-sends.

Day 75 already calls `completeRun` on that same winning pass — milestone send and
`completeRun` sit side by side.

Grading must not be blocked or failed by a push error: the milestone send is
`ctx`-less here (grading has no `ExecutionContext` in the request backstop), so it is
`await`ed inside a `try/catch` that logs and swallows. Grading fails open; push is
strictly less important than grading.

**Dependency note:** `src/services/grading.ts` currently imports only `src/lib/` and
`src/db/`. Adding a `src/push/` import to it is new. Acceptable — `grading.ts` is
already the "impure orchestration" layer. The pure rules stay in `src/lib/rules.ts`.

---

## 7. Service worker

`web/public/sw.js` — copied verbatim into `dist/client/sw.js` by Vite's public-dir
handling. No config change.

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title ?? '75 Hard';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? '',
      icon: '/icon-192.png',
      tag: data.tag ?? 'nudge',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((wins) => {
      const open = wins.find((w) => w.url.includes('/'));
      if (open) return open.focus();
      return clients.openWindow('/today');
    }),
  );
});
```

`icon-192.png` is a single small asset added to `web/public/`. If Phase 5b later
brings a real icon set, this reference already fits.

Registration in `web/main.tsx`, after `createRoot(...).render(...)`:

```ts
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
```

Silent failure is fine: no SW → the reminders toggle detects `!('serviceWorker' in
navigator)` and shows itself disabled.

---

## 8. Client — Me tab

`web/lib/push.ts`:

| Export | Does |
|---|---|
| `pushSupported()` | `'serviceWorker' in navigator && 'PushManager' in window` |
| `pushState()` | `'unsupported' \| 'default' \| 'denied' \| 'subscribed' \| 'granted-unsubscribed'` — reads `Notification.permission` and `reg.pushManager.getSubscription()` |
| `enablePush()` | `requestPermission` → `subscribe({ userVisibleOnly: true, applicationServerKey })` (key from `api.vapidKey()`) → `api.pushSubscribe(sub)`. Throws on denial or failure; caller shows the message. |
| `disablePush()` | `getSubscription()` → `api.pushUnsubscribe(endpoint)` → `sub.unsubscribe()` |

`applicationServerKey` needs the VAPID public key as a `Uint8Array` — one base64url→
bytes helper, ~5 lines, lives in `web/lib/push.ts`.

`web/api.ts` gains:

```ts
vapidKey:       () => call<{ key: string }>('/api/push/vapid-public-key'),
pushSubscribe:  (sub: PushSubscriptionJSON) => call('/api/push/subscribe', {
                  method: 'POST',
                  body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }),
                }),
pushUnsubscribe: (endpoint: string) => call('/api/push/subscribe', {
                  method: 'DELETE', body: JSON.stringify({ endpoint }),
                }),
```

`Me.tsx` — a new block above the `LINKS` list (it is stateful, not a nav link):

- `pushState()` polled on mount.
- `default` / `granted-unsubscribed` → button "Turn on reminders" → `enablePush()`.
- `subscribed` → button "Reminders on — tap to turn off" → `disablePush()`.
- `denied` → disabled row, caption "Turn on notifications for this site in your browser settings."
- `unsupported` → hidden entirely.
- A failed `enablePush()` sets an inline error string rendered in `text-[var(--color-destructive)]` with `role="alert"`.
- Always below the control, muted small print:
  *"On iPhone, add this app to your Home Screen first — Safari only sends reminders to installed apps."*

Follows the existing `Me.tsx` card styling (`border-[var(--color-border)]
bg-[var(--color-card)] rounded-xl p-4`).

---

## 9. Error handling summary

| Failure | Behaviour |
|---|---|
| VAPID secrets unset | `/subscribe` + `/vapid-public-key` → 503; cron sends log a warning and return. Dev works without secrets. |
| One send fails mid-batch | `Promise.allSettled`; the rest still go. Logged. |
| Send → 404 / 410 | Row deleted via `deleteSubByEndpoint`. |
| Send → other non-2xx | Logged, row kept, no retry. |
| `requestPermission()` denied | Toggle moves to the `denied` state; inline caption. No throw past the handler. |
| `pushManager.subscribe()` throws | Inline error on the toggle; state unchanged. |
| Milestone send throws inside grading | `try/catch` logs and swallows; grading completes normally. |
| No service worker / no PushManager | Toggle hidden (`unsupported`). |

---

## 10. Testing

| Target | Kind | Asserts |
|---|---|---|
| `src/push/messages.ts` | pure unit | nudge text for 0 (n/a), 1, 2, many goals left; singular vs plural; milestone text for 25/50/75. |
| `src/db/push.ts` | integration (real D1) | upsert dedups on endpoint; upsert rebinds `user_id`; `deleteSub` respects `user_id`; `listSubsExcept` excludes the given user; `usersToNudge` excludes no-sub users and non-active runs. |
| `src/api/push.ts` | integration | subscribe validates body; subscribe 503 without secrets; unsubscribe idempotent; a user's DELETE cannot remove another user's row; all routes 401 without a session. |
| `runNudge` | integration, `send` mocked | given users with mixed day-completion, exactly the incomplete ones' endpoints are called, with the right text; a `'prune'` result deletes the row. |
| milestone hook | integration, `send` mocked | a run reaching day 25 via grading calls `send` for every *other* sub and none of the achiever's; day 24 sends nothing; a second grading pass over day 25 sends nothing. |
| `vapid.ts` / `send.ts` | — | not directly unit-tested. Covered by Task 1's real-delivery spike. |

`send` is injected or module-mocked (Vitest `vi.mock('../push/send')`) so no test hits
a real push endpoint.

---

## 11. Operator steps (not code)

1. Task 1 generates a VAPID key pair.
2. `npx wrangler secret put VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
   (`VAPID_SUBJECT` = `mailto:you@example.com`).
3. For local dev, put the same three in `.dev.vars` (already git-ignored).
4. `npm run deploy`.
5. No D1 migration. No `wrangler.jsonc` change (cron and bindings already present).

---

## 12. Task breakdown (for the implementation plan)

1. **Spike** — choose the web-push library, generate VAPID keys, send one real
   encrypted notification to a browser subscription end to end. Output: the library
   decision, the keys, and `vapid.ts` + `send.ts` proven working. Throwaway test code
   is fine; the two modules are kept.
2. `src/db/push.ts` + `src/push/messages.ts` + their tests.
3. `src/push/vapid.ts` + `src/push/send.ts` finalised from the spike, with the
   `'ok' | 'prune' | 'error'` contract and 404/410 mapping.
4. `src/api/push.ts` routes, `Env` fields, router wiring, tests.
5. `web/public/sw.js` + `web/public/icon-192.png` + `main.tsx` registration +
   `web/lib/push.ts` + `web/api.ts` additions.
6. `Me.tsx` toggle + iOS caption.
7. `src/services/nudge.ts` + `worker.ts` wiring + milestone hook in `grading.ts` +
   selection tests.

---

## 13. Self-review

- **Placeholders:** none. Library pick is explicitly deferred to Task 1 with a named
  candidate and a hard constraint (runs on `workerd`).
- **Consistency:** milestone recipients — §1, §3 (`listSubsExcept`), §6, §10 all say
  "every other subscribed user regardless of run state." Nudge recipients — §1, §5,
  §10 all say "active run + has sub + incomplete day." No contradiction.
- **Scope:** one plan, seven tasks, one new module dir, no migration, no schema or
  config change. PWA install carved off cleanly as 5b. Focused.
- **Ambiguity:** "day that just passed" in §6 is pinned to "the grading pass that wins
  the `lockDay` claim," which is already single-winner. "The other four members" from
  the original spec is resolved to "every user row except the achiever that has a
  subscription."
