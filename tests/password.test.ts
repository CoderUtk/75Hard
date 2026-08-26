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
