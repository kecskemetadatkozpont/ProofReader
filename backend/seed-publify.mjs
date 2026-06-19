/* Publify — one-time seed: create the 9 researcher Auth users (email+password),
 * fill their profile (mtmt_id/orcid/affiliation/is_researcher), and insert their
 * publications. Dependency-free (Node 18+ global fetch).
 *
 * Run AFTER migration-04-publify.sql. Secrets come from the environment — nothing
 * is committed:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_KEY=<service_role key> \
 *   PUBLIFY_PW_FILE=/path/to/passwords.json   # { "email": "plaintext-password", ... }
 *   node backend/seed-publify.mjs
 *
 * Idempotent-ish: re-creating an existing user is skipped; profiles upsert; a
 * publication unique(researcher_id, mtid) makes the publication insert a no-op on
 * re-run (on_conflict=do_nothing).
 */
import { readFileSync } from 'node:fs';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const PW_FILE = process.env.PUBLIFY_PW_FILE;
if (!URL || !KEY || !PW_FILE) { console.error('Set SUPABASE_URL, SUPABASE_SERVICE_KEY, PUBLIFY_PW_FILE.'); process.exit(1); }

const HERE = new global.URL('.', import.meta.url).pathname;
const ROOT = HERE.replace(/\/backend\/$/, '/');
const passwords = JSON.parse(readFileSync(PW_FILE, 'utf8'));

// load the bundled data modules by evaluating them with a window shim
function loadGlobals(file) { const win = {}; const code = readFileSync(ROOT + file, 'utf8'); new Function('window', code)(win); return win; }
const win = {}; Object.assign(win, loadGlobals('auth.js')); // sets window.PRAuth
const pubsWin = loadGlobals('publications.js');             // sets window.PRPubs
const SEED = win.PRAuth.SEED;
const PUBS = pubsWin.PRPubs.data;

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
async function api(path, opts) {
  const r = await fetch(URL + path, opts);
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
  return { ok: r.ok, status: r.status, body: j, text: t };
}
async function ensureUser(email, password, name) {
  // try create; if the email already exists, look it up
  const c = await api('/auth/v1/admin/users', { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }) });
  if (c.ok && c.body && c.body.id) return c.body.id;
  // already registered (422) → find by email
  const list = await api('/auth/v1/admin/users?per_page=200', { headers: H });
  const u = list.body && (list.body.users || list.body).find((x) => (x.email || '').toLowerCase() === email.toLowerCase());
  if (u) { // make sure the password matches what we distributed
    await api('/auth/v1/admin/users/' + u.id, { method: 'PUT', headers: H, body: JSON.stringify({ password, email_confirm: true }) });
    return u.id;
  }
  throw new Error('could not create or find user ' + email + ' (' + c.status + ' ' + c.text.slice(0, 120) + ')');
}

const colleagues = SEED.filter((u) => PUBS[String(u.email).toLowerCase()]);
console.log('Seeding', colleagues.length, 'researchers…');
let okUsers = 0, okPubs = 0;
for (const u of colleagues) {
  const email = String(u.email).toLowerCase();
  const rec = PUBS[email];
  const pw = passwords[email] || passwords[u.email];
  if (!pw) { console.log('  ! no password for', email, '— skipping'); continue; }
  try {
    const id = await ensureUser(email, pw, u.name);
    // upsert the profile (trigger created it; enrich it)
    await api('/rest/v1/profiles?on_conflict=id', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id, email, name: u.name, color: u.color, plan: u.plan || 'pro', role: 'user', status: 'approved', is_researcher: true, mtmt_id: String(rec.mtmtId || ''), orcid: rec.orcid || null, affiliation: /@nje\.hu$/.test(email) ? 'Neumann János Egyetem' : (/@sze\.hu$/.test(email) ? 'Széchenyi István Egyetem' : null) }) });
    // insert publications (do nothing on the unique(researcher_id, mtid) conflict)
    const rows = (rec.publications || []).map((p) => ({ researcher_id: id, mtid: p.mtid, type: p.type, type_hu: p.typeHu, title: p.title, year: p.year, first_author: p.firstAuthor, author_count: p.authorCount, journal: p.journal, volume: p.volume, issue: p.issue, pages: p.pages, doi: p.doi, citations: p.citations || 0, indep_citations: p.indepCitations || 0, oa_type: p.oaType, category: p.category, core: p.core, citation: p.citation, mtmt_url: p.mtmtUrl }));
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const r = await api('/rest/v1/publications?on_conflict=researcher_id,mtid', { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(chunk) });
      if (!r.ok) console.log('    publications insert', r.status, r.text.slice(0, 160));
      else okPubs += chunk.length;
    }
    okUsers++; console.log('  ✓', u.name.padEnd(16), email, '·', rows.length, 'publications');
  } catch (e) { console.log('  ✗', u.name, '—', e.message); }
}
console.log('\nDone:', okUsers, 'users,', okPubs, 'publications upserted.');
