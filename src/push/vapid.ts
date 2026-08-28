import type { Env } from '../worker';
import { b64url, fromB64url } from '../lib/ids';

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** The one place the "all three VAPID vars present" check lives. */
export function vapidFromEnv(env: Env): VapidConfig | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  // Trim: a secret pasted with a trailing newline decodes to the wrong byte length.
  return {
    publicKey: env.VAPID_PUBLIC_KEY.trim(),
    privateKey: env.VAPID_PRIVATE_KEY.trim(),
    subject: env.VAPID_SUBJECT.trim(),
  };
}

/** RFC 8292 allows up to 24h. 12h leaves room for clock skew either way. */
const EXPIRY_SECONDS = 12 * 60 * 60;

/**
 * The `Authorization` header value for a VAPID-signed push (RFC 8292 §3):
 * `vapid t=<ES256 JWT>, k=<application server public key>`.
 *
 * `audience` is the scheme+host of the push endpoint, e.g. "https://fcm.googleapis.com".
 */
export async function vapidAuthHeader(vapid: VapidConfig, audience: string): Promise<string> {
  const key = await importSigningKey(vapid);

  const header = b64urlString(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64urlString(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + EXPIRY_SECONDS,
    sub: vapid.subject,
  }));
  const signingInput = `${header}.${claims}`;

  // WebCrypto ECDSA emits the raw r||s pair, which is exactly the JWS ES256 form.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `vapid t=${signingInput}.${b64url(new Uint8Array(sig))}, k=${vapid.publicKey}`;
}

/**
 * `VAPID_PUBLIC_KEY` is the raw 65-byte uncompressed P-256 point, base64url.
 * `VAPID_PRIVATE_KEY` is the raw 32-byte private scalar, base64url (the JWK `d` value).
 * That is the pair every web-push tool emits, and the public half is what the browser
 * wants as `applicationServerKey`. WebCrypto can only import that combination as a JWK,
 * so reassemble x/y from the point here.
 */
function importSigningKey(vapid: VapidConfig): Promise<CryptoKey> {
  const point = fromB64url(vapid.publicKey);
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(point.slice(1, 33)),
      y: b64url(point.slice(33, 65)),
      d: vapid.privateKey,
      ext: false,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

function b64urlString(s: string): string {
  return b64url(new TextEncoder().encode(s));
}
