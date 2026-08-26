# Seeding family users

There is no sign-up screen. Users are inserted by hand, once, by whoever owns the
Cloudflare account.

## 1. Generate a PIN hash

Run once per person, substituting their 4-digit PIN for `1234`:

```bash
node --input-type=module -e "
const pin = process.argv[1];
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'}, key, 256);
const b64 = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
console.log(JSON.stringify({ hash: b64(new Uint8Array(bits)), salt: b64(salt) }));
" 1234
```

Output is one line of JSON:

```json
{"hash":"...43 chars...","salt":"...22 chars..."}
```

The iteration count (`100000`), the hash (`SHA-256`), the 256-bit output and the
base64url encoding must all match `src/lib/password.ts` and `src/lib/ids.ts` exactly.
Change any one of them and login fails with "wrong PIN" and no other clue.

This script was round-trip tested against `verifyPin`: a correct PIN verifies, a wrong
PIN is rejected.

## 2. Insert the user

One command per person. Paste the `hash` and `salt` from step 1:

```bash
npx wrangler d1 execute 75hard --remote --command \
  "INSERT INTO users (id,name,color,pin_hash,pin_salt,created_at) \
   VALUES (lower(hex(randomblob(16))),'Utkarsh','#EA580C','<HASH>','<SALT>',unixepoch()*1000)"
```

`failed_pins` defaults to 0 and `locked_until` is nullable, so neither is listed.

`name` is `UNIQUE` — a repeated name fails with a constraint error rather than creating
a second account. That is deliberate: the login screen picks people by name.

Suggested colours, one per person, all legible on the `#0F172A` background:

| Colour    | |
|-----------|---|
| `#EA580C` | orange |
| `#22C55E` | green |
| `#38BDF8` | blue |
| `#A78BFA` | violet |
| `#FBBF24` | amber |

Drop `--remote` to seed the local dev database instead. Do that first if you want to
try the flow before touching production.

## Resetting a forgotten PIN

Re-run step 1 for the new PIN, then:

```bash
npx wrangler d1 execute 75hard --remote --command \
  "UPDATE users SET pin_hash='<HASH>', pin_salt='<SALT>', failed_pins=0, locked_until=NULL \
   WHERE name='Utkarsh'"
```

Clearing `failed_pins` and `locked_until` also lifts a 15-minute lockout.

## Never

Do not store the plaintext PINs anywhere in this repo. The hash and salt are all the
app needs, and both are useless without the PIN.
