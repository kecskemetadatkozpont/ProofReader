/* Publify — set fresh TEMPORARY passwords for colleagues and print them LOCALLY so you can send them.
 *
 * Why a script (and not the chat): live passwords shouldn't be pasted into a chat transcript. This runs on
 * YOUR machine with YOUR service key, prints "email -> password" to your terminal, and also writes
 * colleague-passwords.json next to it. Send each colleague their line, then they change it under
 * Profile -> Settings -> "Change password".
 *
 * SAFETY: by default this only touches the 4 Széchenyi accounts that have NEVER logged in. It does NOT
 * touch anyone who is already using the system (that would lock them out). Pass emails as CLI args to
 * override the list.
 *
 * Run:
 *   cd backend
 *   SUPABASE_SERVICE_KEY="$(cat ~/.publify-supabase-key)" node reset-colleague-passwords.mjs
 *   # or specify who:  ... node reset-colleague-passwords.mjs cseke.tibor@sze.hu ihasz.mate@sze.hu
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.SUPABASE_URL || 'https://jokqthwszkweyqmmdesn.supabase.co';
// service_role key: from env, or fall back to the local key file you already keep
let KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { try { KEY = readFileSync(join(homedir(), '.publify-supabase-key'), 'utf8').trim(); } catch { /* */ } }
if (!KEY) { console.error('Set SUPABASE_SERVICE_KEY (or keep your key at ~/.publify-supabase-key).'); process.exit(1); }

// default: the 4 Széchenyi colleagues who have never signed in (safe to (re)set)
const DEFAULT_TARGETS = [
  'cseke.tibor@sze.hu',
  'jagicza.marton@ga.sze.hu',
  'ihasz.mate@sze.hu',
  'pekk.leticia@ga.sze.hu',
];
const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS;

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

// readable temp password: no ambiguous chars, guaranteed letters+digits, easy to type/paste once
function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', d = '23456789';
  const pick = (set, n) => { const b = randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += set[b[i] % set.length]; return s; };
  return 'Pub-' + pick(A, 1) + pick(a, 4) + '-' + pick(d, 4);   // e.g. Pub-Kmpqr-7394
}

async function api(path, opts) {
  const r = await fetch(URL + path, opts);
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return r.json();
}

const out = {};
let page = 1, users = [];
while (true) {                                   // page through admin users to resolve emails -> ids
  const d = await api('/auth/v1/admin/users?per_page=200&page=' + page, { headers: H });
  const batch = d.users || d || [];
  users = users.concat(batch);
  if (batch.length < 200) break;
  page++;
}
const byEmail = {};
users.forEach((u) => { if (u.email) byEmail[u.email.toLowerCase()] = u; });

for (const email of targets) {
  const u = byEmail[email.toLowerCase()];
  if (!u) { console.log('  ! not found, skipping:', email); continue; }
  if (u.last_sign_in_at) { console.log('  ! already signed in, SKIPPING (would lock them out):', email); continue; }
  const pw = tempPassword();
  await api('/auth/v1/admin/users/' + u.id, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw, email_confirm: true }) });
  out[email] = pw;
  console.log(email + '  ->  ' + pw);
}

writeFileSync('colleague-passwords.json', JSON.stringify(out, null, 2));
console.log('\nWrote colleague-passwords.json (' + Object.keys(out).length + ' accounts).');
console.log('Send each colleague their line; they can change it under Profile → Settings → "Change password".');
