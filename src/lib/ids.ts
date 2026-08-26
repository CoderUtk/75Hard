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
