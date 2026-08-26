import { b64url, fromB64url } from './ids';

const ITERATIONS = 100_000;

export async function hashPin(
  pin: string,
  existingSalt?: string,
): Promise<{ hash: string; salt: string }> {
  // getRandomValues is typed to accept/return Uint8Array<ArrayBufferLike> (which
  // includes SharedArrayBuffer), but a freshly allocated Uint8Array(16) is always
  // backed by a plain, non-shared ArrayBuffer. Assert that real invariant so the
  // result satisfies BufferSource below.
  const salt = existingSalt
    ? fromB64url(existingSalt)
    : (crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>);

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
