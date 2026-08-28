import { describe, it, expect } from 'vitest';
import { encryptPayload, sendPush, type VapidConfig, type WebPushSub } from '../src/push/send';
import { b64url, fromB64url } from '../src/lib/ids';

const enc = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
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

/** Stand-in for a browser PushSubscription: an ECDH P-256 keypair + 16-byte auth secret. */
async function makeSubscriber(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const sub: WebPushSub = {
    endpoint,
    p256dh: b64url(publicBytes),
    auth: b64url(authSecret),
  };
  return { sub, privateKey: kp.privateKey, publicBytes, authSecret };
}

/** The user-agent half of RFC 8291: parse the aes128gcm body and recover the plaintext. */
async function decryptBody(
  body: Uint8Array<ArrayBuffer>,
  privateKey: CryptoKey,
  uaPublic: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);

  expect(recordSize).toBe(4096);
  expect(idlen).toBe(65);

  const asKey = await crypto.subtle.importKey(
    'raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, privateKey, 256),
  );
  const ikm = await hkdf(
    authSecret, shared, concat(enc('WebPush: info\0'), uaPublic, asPublic), 32,
  );
  const cekBytes = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const cek = await crypto.subtle.importKey('raw', cekBytes, 'AES-GCM', false, ['decrypt']);

  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cek, ciphertext),
  );
  // Last record ends with the 0x02 delimiter, then zero padding.
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  expect(plain[end - 1]).toBe(0x02);
  return new TextDecoder().decode(plain.slice(0, end - 1));
}

async function makeVapid(): Promise<VapidConfig & { verifyKey: CryptoKey }> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    publicKey: b64url(pub),
    privateKey: jwk.d!,
    subject: 'mailto:utkarshg08@gmail.com',
    verifyKey: kp.publicKey,
  };
}

/** Captures the request instead of sending it. */
function stubFetch(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(status === 204 ? null : 'body', { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('aes128gcm payload encryption (RFC 8291)', () => {
  it('round-trips a payload the subscriber can decrypt', async () => {
    const { sub, privateKey, publicBytes, authSecret } = await makeSubscriber();
    const plaintext = JSON.stringify({ title: '75 Hard', body: 'spike test', tag: 'nudge' });

    const body = await encryptPayload(sub, plaintext);

    expect(await decryptBody(body, privateKey, publicBytes, authSecret)).toBe(plaintext);
  });

  it('uses a fresh salt and ephemeral key per send', async () => {
    const { sub } = await makeSubscriber();
    const a = await encryptPayload(sub, 'hello');
    const b = await encryptPayload(sub, 'hello');
    expect(b64url(a.slice(0, 16))).not.toBe(b64url(b.slice(0, 16)));
    expect(b64url(a.slice(21, 86))).not.toBe(b64url(b.slice(21, 86)));
  });
});

describe('sendPush', () => {
  it('POSTs a decryptable aes128gcm body with a valid VAPID JWT', async () => {
    const { sub, privateKey, publicBytes, authSecret } = await makeSubscriber();
    const vapid = await makeVapid();
    const { fn, calls } = stubFetch(201);
    const plaintext = 'day 42 has 3 goals left';
    const before = Math.floor(Date.now() / 1000);

    expect(await sendPush(vapid, sub, plaintext, fn)).toBe('ok');
    expect(calls).toHaveLength(1);

    const { url, init } = calls[0]!;
    expect(url).toBe(sub.endpoint);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['TTL']).toBe('2419200');

    // Body decrypts back to the plaintext.
    expect(await decryptBody(
      init.body as Uint8Array<ArrayBuffer>, privateKey, publicBytes, authSecret,
    ))
      .toBe(plaintext);

    // Authorization: vapid t=<jwt>, k=<publicKey>
    const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(headers['Authorization']!);
    expect(m).not.toBeNull();
    const [, jwt, k] = m as RegExpExecArray & [string, string, string];
    expect(k).toBe(vapid.publicKey);

    const [h, p, s] = jwt.split('.') as [string, string, string];
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    expect(header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:utkarshg08@gmail.com');
    expect(claims.exp).toBeGreaterThan(before);
    expect(claims.exp).toBeLessThanOrEqual(before + 24 * 60 * 60);

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapid.verifyKey,
      fromB64url(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it('maps push-service responses to results', async () => {
    const { sub } = await makeSubscriber();
    const vapid = await makeVapid();
    const cases: [number, string][] = [
      [201, 'ok'], [200, 'ok'], [404, 'prune'], [410, 'prune'],
      [400, 'error'], [429, 'error'], [500, 'error'],
    ];
    for (const [status, expected] of cases) {
      expect(await sendPush(vapid, sub, 'x', stubFetch(status).fn)).toBe(expected);
    }
  });

  it('returns error instead of throwing when the network rejects', async () => {
    const { sub } = await makeSubscriber();
    const vapid = await makeVapid();
    const boom = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    expect(await sendPush(vapid, sub, 'x', boom)).toBe('error');
  });

  it('returns error instead of throwing on a malformed subscription', async () => {
    const vapid = await makeVapid();
    const bad: WebPushSub = { endpoint: 'https://x.example/p', p256dh: 'notakey', auth: 'nope' };
    expect(await sendPush(vapid, bad, 'x', stubFetch(201).fn)).toBe('error');
  });
});
