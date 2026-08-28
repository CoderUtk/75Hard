import { fromB64url } from '../lib/ids';
import { vapidAuthHeader, type VapidConfig } from './vapid';

export type { VapidConfig };
export type WebPushSub = { endpoint: string; p256dh: string; auth: string };
export type SendResult = 'ok' | 'prune' | 'error';

/** 28 days — the push service holds the message this long if the device is offline. */
const TTL_SECONDS = 2419200;
/** Single-record encoding; our payloads are a few hundred bytes. */
const RECORD_SIZE = 4096;

/**
 * Encrypt `payload` for `sub` and POST it to the push service.
 * Never throws: `'prune'` means the subscription is dead and should be deleted,
 * `'error'` means this one send failed and the caller should move on.
 *
 * `doFetch` exists so tests can capture the request; production uses global fetch.
 */
export async function sendPush(
  vapid: VapidConfig,
  sub: WebPushSub,
  payload: string,
  doFetch: typeof fetch = (...args) => fetch(...args),
): Promise<SendResult> {
  try {
    const body = await encryptPayload(sub, payload);
    const res = await doFetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthHeader(vapid, new URL(sub.endpoint).origin),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(TTL_SECONDS),
      },
      body,
    });

    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 410) return 'prune';

    const text = await res.text().catch(() => '');
    console.error(`push send failed: ${res.status} ${text}`);
    return 'error';
  } catch (err) {
    console.error('push send threw:', err);
    return 'error';
  }
}

/**
 * RFC 8291 aes128gcm body:
 * `salt(16) | record size(4) | key id length(1) | server public key(65) | ciphertext`
 *
 * Exported so the crypto can be tested without a network round trip.
 */
export async function encryptPayload(
  sub: WebPushSub,
  payload: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);

  // Ephemeral server keypair — one per message, never persisted.
  const local = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256),
  );

  const ikm = await hkdf(
    authSecret, shared, concat(encode('WebPush: info\0'), uaPublic, asPublic), 32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const cekBytes = await hkdf(salt, ikm, encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encode('Content-Encoding: nonce\0'), 12);

  const cek = await crypto.subtle.importKey('raw', cekBytes, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (only) record; no extra padding — the size is not secret here.
  const plaintext = concat(encode(payload), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cek, plaintext),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8,
  );
  return new Uint8Array(bits);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function encode(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}
