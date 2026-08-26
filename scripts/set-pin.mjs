// Set or reset a user's PIN, end to end. Generates the salt+hash and applies the
// UPDATE in one step, so no placeholder can survive into the database.
//
//   node scripts/set-pin.mjs <name> <4-digit-pin> [--local]
//
// Derivation must stay identical to src/lib/password.ts.
import { execFileSync } from 'node:child_process';

const [name, pin, ...rest] = process.argv.slice(2);
const local = rest.includes('--local');

if (!name || !pin) {
  console.error('usage: node scripts/set-pin.mjs <name> <4-digit-pin> [--local]');
  process.exit(1);
}
if (!/^\d{4}$/.test(pin)) {
  console.error(`refusing: PIN must be exactly 4 digits, got ${JSON.stringify(pin)}`);
  process.exit(1);
}

const b64 = (b) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'],
);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256,
);

const sql =
  `UPDATE users SET pin_hash='${b64(new Uint8Array(bits))}', pin_salt='${b64(salt)}',`
  + ` failed_pins=0, locked_until=NULL WHERE name='${name.replace(/'/g, "''")}'`;

const out = execFileSync('npx', ['wrangler', 'd1', 'execute', '75hard',
  local ? '--local' : '--remote', '--command', sql], { encoding: 'utf8', shell: true });

// D1 reports 0 changes for a name that does not exist — that must not look like success.
if (/"changes":\s*0/.test(out) || /"rows_written":\s*0/.test(out)) {
  console.error(`no user named ${JSON.stringify(name)} was updated. Check the name.`);
  process.exit(1);
}
console.log(`PIN set for ${name}. Any lockout was cleared.`);
