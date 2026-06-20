/* Publify — seed the Doctoral School with demo data: a few research interests on the supervisors,
 * 3 demo students (milestones / degree requirements / tasks) and a few open topics. Idempotent-ish:
 * skips if students already exist. Run AFTER migration-07-phd.sql, with env:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   node backend/seed-phd.mjs
 */
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('Set SUPABASE_URL, SUPABASE_SERVICE_KEY.'); process.exit(1); }
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const HJ = { ...H, 'Content-Type': 'application/json' };
const j = async (p, o) => { const r = await fetch(URL + p, o); const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { } return { ok: r.ok, status: r.status, data: d, text: t }; };
const ins = (table, body) => j('/rest/v1/' + table, { method: 'POST', headers: { ...HJ, Prefer: 'return=representation' }, body: JSON.stringify(body) });

(async () => {
  // already seeded?
  const exist = await j('/rest/v1/phd_students?select=id&limit=1', { headers: H });
  if (exist.data && exist.data.length) { console.log('phd_students already has rows — skipping demo seed.'); return; }

  // supervisors = the seeded researchers
  const sup = (await j('/rest/v1/profiles?select=id,name,email&is_supervisor=eq.true', { headers: H })).data || [];
  const by = (frag) => sup.find((s) => (s.name || '').indexOf(frag) >= 0) || sup[0];
  if (!sup.length) { console.error('No supervisors found (run migration-07 first).'); process.exit(1); }
  console.log(sup.length, 'supervisors available.');

  // a couple of research interests per supervisor (illustrative)
  const interests = { 'Weltsch': ['Felületkezelés', 'Lézertechnológia', 'Kompozitok'], 'Fülöp': ['Fémfröccsöntés', 'Anyagtudomány', 'Gyártástechnológia'], 'Pekk': ['Aktív idősödés', 'Tudásmenedzsment', 'Társadalomtudomány'], 'Nagy Zoltán': ['Képfeldolgozás', 'OOD detekció', 'Gépi tanulás'], 'Sütheő': ['Járműtechnika', 'Fenntarthatóság'] };
  for (const s of sup) { const k = Object.keys(interests).find((f) => (s.name || '').indexOf(f) >= 0); if (k) await j('/rest/v1/profiles?id=eq.' + s.id, { method: 'PATCH', headers: HJ, body: JSON.stringify({ research_interests: interests[k] }) }); }

  const students = [
    { sup: by('Weltsch'), name: 'Kovács Péter', email: 'kovacs.peter@phd.nje.hu', enrollment_year: 2023, topic: 'Lézeres felületkezelés hatása szálerősített kompozitok kötésére', total_credits: 92, status: 'Aktív', ethics_status: 'APPROVED',
      ms: [ ['Komplex vizsga letétele', 'Vizsga', 0, '2025-06-15', 'Folyamatban'], ['Q1 folyóiratcikk benyújtása', 'Publikáció', 20, '2025-09-30', 'Folyamatban'], ['Kutatásmódszertan kurzus', 'Tanegység', 6, '2024-12-20', 'Teljesítve'] ],
      dr: [ ['Tudományos publikációk', 'SCIENTIFIC', 3, 1, 'db'], ['Oktatási óraszám', 'TEACHING', 80, 35, 'óra'], ['Megszerzett kreditek', 'ACADEMIC', 240, 92, 'kredit'] ],
      tk: [ ['Mérési adatok feldolgozása', 'IN_PROGRESS', 'HIGH', '2025-05-30'], ['Irodalmazás a 2. cikkhez', 'TODO', 'MEDIUM', '2025-06-20'] ] },
    { sup: by('Fülöp'), name: 'Nagy Eszter', email: 'nagy.eszter@phd.nje.hu', enrollment_year: 2022, topic: 'Fémfröccsöntött alkatrészek mechanikai tulajdonságainak paraméteroptimalizálása', total_credits: 148, status: 'Aktív', ethics_status: 'APPROVED',
      ms: [ ['Disszertáció tervezet', 'Disszertáció', 0, '2026-02-28', 'Tervezett'], ['Konferencia-előadás (IEEE)', 'Publikáció', 10, '2025-04-10', 'Teljesítve'] ],
      dr: [ ['Tudományos publikációk', 'SCIENTIFIC', 3, 2, 'db'], ['Megszerzett kreditek', 'ACADEMIC', 240, 148, 'kredit'] ],
      tk: [ ['Bírálói észrevételek átvezetése', 'TODO', 'HIGH', '2025-05-15'] ] },
    { sup: by('Pekk'), name: 'Szabó Gergő', email: 'szabo.gergo@phd.sze.hu', enrollment_year: 2024, topic: 'Az aktív idősödés digitális eszközökkel való támogatása', total_credits: 46, status: 'Aktív', ethics_status: 'PENDING',
      ms: [ ['Etikai engedély beszerzése', 'Vizsga', 0, '2025-05-01', 'Folyamatban'], ['Szakirodalmi áttekintés', 'Tanegység', 8, '2025-01-31', 'Teljesítve'] ],
      dr: [ ['Tudományos publikációk', 'SCIENTIFIC', 3, 0, 'db'], ['Megszerzett kreditek', 'ACADEMIC', 240, 46, 'kredit'] ],
      tk: [ ['Kérdőív összeállítása', 'IN_PROGRESS', 'MEDIUM', '2025-06-10'] ] }
  ];

  let nS = 0, nC = 0;
  for (const st of students) {
    const r = await ins('phd_students', { supervisor_id: st.sup.id, name: st.name, email: st.email, enrollment_year: st.enrollment_year, topic: st.topic, total_credits: st.total_credits, required_credits: 240, status: st.status, ethics_status: st.ethics_status, complex_exam: { status: st.enrollment_year <= 2023 ? 'SCHEDULED' : 'NOT_ELIGIBLE' } });
    if (!r.ok || !r.data || !r.data[0]) { console.log('  ✗ student', st.name, r.status, r.text.slice(0, 120)); continue; }
    const sid = r.data[0].id; nS++;
    for (const m of st.ms) { await ins('phd_milestones', { student_id: sid, title: m[0], type: m[1], credits: m[2], deadline: m[3], status: m[4] }); nC++; }
    for (const d of st.dr) { await ins('phd_degree_requirements', { student_id: sid, title: d[0], category: d[1], target_value: d[2], current_value: d[3], unit: d[4], is_auto: d[1] === 'ACADEMIC' }); nC++; }
    for (const t of st.tk) { await ins('phd_tasks', { student_id: sid, title: t[0], status: t[1], priority: t[2], due_date: t[3] }); nC++; }
    console.log('  ✓', st.name, '→', st.sup.name);
  }

  const topics = [
    { sup: by('Weltsch'), title: 'Femtoszekundumos lézeres felületmódosítás ipari alkalmazásai', description: 'Hallgatót keresünk a lézeres felületkezelés és tapadásnövelés területén.', tags: ['Lézertechnológia', 'Felületkezelés', 'Kompozitok'] },
    { sup: by('Nagy Zoltán'), title: 'Valós idejű out-of-distribution detekció autonóm járművekhez', description: 'Robusztus OOD-detekció kamerás és LiDAR-adatokon, mély tanulással.', tags: ['Gépi tanulás', 'OOD', 'Autonóm járművek'] },
    { sup: by('Pekk'), title: 'Digitális egészségmegőrzés idősödő társadalomban', description: 'Interdiszciplináris kutatás a technológia-elfogadásról és aktív idősödésről.', tags: ['Társadalomtudomány', 'eHealth', 'Aktív idősödés'] }
  ];
  let nT = 0;
  for (const t of topics) { const r = await ins('phd_topics', { supervisor_id: t.sup.id, title: t.title, description: t.description, tags: t.tags, status: 'OPEN' }); if (r.ok) nT++; }

  console.log(`\nDone: ${nS} students, ${nC} child rows, ${nT} open topics.`);
})().catch((e) => { console.error(e); process.exit(2); });
