/* Publify — harvest open-access PDFs for the seeded publications and load them into Storage +
 * publication_files, so users only need to upload what isn't findable online. For each publication
 * that HAS a DOI and does NOT already have a file, asks Unpaywall for an OA PDF, downloads it
 * (verifying real PDF bytes + a size cap), uploads to publication-files/<researcher>/<pub>/<file>
 * and inserts the metadata row. Idempotent: skips publications that already have any file.
 * Dependency-free (Node 18+). Secrets from env:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, UNPAYWALL_EMAIL  node backend/harvest-pdfs.mjs
 */
import { randomUUID } from 'node:crypto';

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY, EMAIL = process.env.UNPAYWALL_EMAIL;
if (!URL || !KEY || !EMAIL) { console.error('Set SUPABASE_URL, SUPABASE_SERVICE_KEY, UNPAYWALL_EMAIL.'); process.exit(1); }
const BUCKET = 'publication-files', MAX_BYTES = 30 * 1024 * 1024, CONCURRENCY = 5;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const HJ = { ...H, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jget(path) { const r = await fetch(URL + path, { headers: H }); return r.json(); }
function fname(p) {
  var base = (p.title || p.doi || 'publication').toString().slice(0, 90).replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || 'publication') + '.pdf';
}
async function unpaywall(doi) {
  try {
    const r = await fetch('https://api.unpaywall.org/v2/' + encodeURIComponent(doi) + '?email=' + encodeURIComponent(EMAIL), { headers: { 'User-Agent': 'Publify/1.0 (' + EMAIL + ')' } });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d.is_oa) return null;
    var locs = [d.best_oa_location].concat(d.oa_locations || []).filter(Boolean);
    for (const l of locs) { if (l && l.url_for_pdf) return l.url_for_pdf; }
    return null;
  } catch (e) { return null; }
}
async function downloadPdf(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 Publify/1.0', Accept: 'application/pdf,*/*' } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000 || buf.length > MAX_BYTES) return null;
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return null;   // landing page / HTML, not a PDF
    return buf;
  } catch (e) { return null; }
}

const pubs = await jget('/rest/v1/publications?select=id,researcher_id,doi,title&doi=not.is.null&order=researcher_id');
const existing = await jget('/rest/v1/publication_files?select=publication_id');
const hasFile = new Set((existing || []).map((x) => x.publication_id));
const todo = pubs.filter((p) => !hasFile.has(p.id));
console.log(`${pubs.length} publications with a DOI · ${todo.length} without a file yet → checking Unpaywall…\n`);

let found = 0, uploaded = 0, noOa = 0, badPdf = 0, fail = 0;
async function handle(p) {
  const pdfUrl = await unpaywall(p.doi);
  if (!pdfUrl) { noOa++; return; }
  found++;
  const buf = await downloadPdf(pdfUrl);
  if (!buf) { badPdf++; return; }
  const fid = randomUUID(), path = p.researcher_id + '/' + p.id + '/' + fid;
  const up = await fetch(URL + '/storage/v1/object/' + BUCKET + '/' + path, { method: 'POST', headers: { ...H, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: buf });
  if (!up.ok) { fail++; console.log('  ! storage', up.status, (p.doi || '').slice(0, 40)); return; }
  const ins = await fetch(URL + '/rest/v1/publication_files', { method: 'POST', headers: { ...HJ, Prefer: 'return=minimal' }, body: JSON.stringify({ id: fid, publication_id: p.id, owner_id: p.researcher_id, name: fname(p), mime: 'application/pdf', size: buf.length, storage_path: path }) });
  if (!ins.ok) { fail++; const t = await ins.text(); console.log('  ! row', ins.status, t.slice(0, 80)); return; }
  uploaded++;
  console.log(`  ✓ ${(buf.length / 1024 / 1024).toFixed(1)}MB  ${fname(p).slice(0, 70)}`);
}

// simple concurrency pool
let i = 0;
async function worker() { while (i < todo.length) { const p = todo[i++]; await handle(p); await sleep(120); } }
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nDone. OA PDF found: ${found} · uploaded: ${uploaded} · no OA: ${noOa} · not-a-PDF/too-big: ${badPdf} · errors: ${fail}`);
console.log(`Publications still needing a manual upload (no DOI or no OA): roughly ${448 - uploaded - hasFile.size}.`);
