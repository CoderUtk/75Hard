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

it('upsertPhoto inserts then replaces on the same (user, date)', async () => {
  const { upsertPhoto, getPhoto, listPhotoDates } = await import('../src/db/photos');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM photos'),
    env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM users'),
  ]);

  // Create test users and runs
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u1','A','#EA580C','h','s',1)"),
    env.DB.prepare("INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) VALUES ('u2','B','#000000','h','s',1)"),
  ]);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO runs (id,user_id,variant,attempt_no,start_date,status) VALUES ('r1','u1','hard',1,'2026-08-01','active')"),
  ]);

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
