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

it('has a photos table and an R2 bucket bound', async () => {
  const row = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='photos'",
  ).first<{ name: string }>();
  expect(row?.name).toBe('photos');

  await env.PHOTOS.put('probe', 'hello');
  const obj = await env.PHOTOS.get('probe');
  expect(await obj?.text()).toBe('hello');
});

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

it('upsertPhoto inserts then replaces on the same (user, date)', async () => {
  const { upsertPhoto, getPhoto, listPhotoDates } = await import('../src/db/photos');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO runs (id,user_id,variant,attempt_no,start_date,status) VALUES ('r1','u1','hard',1,'2026-08-01','active')"),
  ]);

  await upsertPhoto(env.DB, 'u1', 'r1', '2026-08-01', 'u1/r1/2026-08-01.jpg', 1000);
  await upsertPhoto(env.DB, 'u1', 'r1', '2026-08-03', 'u1/r1/2026-08-03.jpg', 3000);
  await upsertPhoto(env.DB, 'u1', 'r1', '2026-08-01', 'u1/r1/2026-08-01.jpg', 9999);

  const dates = await listPhotoDates(env.DB, 'u1');
  expect(dates).toEqual(['2026-08-03', '2026-08-01']);

  const row = await getPhoto(env.DB, 'u1', '2026-08-01');
  expect(row?.at).toBe(9999);

  expect(await getPhoto(env.DB, 'u2', '2026-08-01')).toBeNull();
});
