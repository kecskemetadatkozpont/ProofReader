# Research Management — teljes kutatás-támogató modul (design)

> Publify-ba ágyazott, end-to-end kutatási életciklus: ötlettől a benyújtott cikkig.
> Status: **DESIGN v1** — épül, mint a PhD-modul (fázisonként, önállóan szállítva).
> A modul a meglévő Publify infrára ül: Supabase (Auth/Postgres/Storage/Realtime), PhD-management
> (supervision, KPI, „View as"), LaTeX editor, publikációk, usage/cost.

---

## 0. Alapelv — a kutatás mint állapotgép

Minden kutatás egy **Research Project** entitás, ami egy **stage-pipeline**-on halad végig. A platform
minden stage-hez ad eszközöket, és minden lépés **provenance-loggal** (ki, mit, miből, mikor) +
**költségkövetéssel** (AI + compute) jár — pont a disszertáció `RESEARCH_LOG.md` kultúrájának
általánosítása.

```
[0 Setup] → [1 Ötlet] → [2 Irodalom] → [3 Terv/Protokoll] → [4 Adat] →
        → [5 Számítás] → [6 Elemzés] → [7 Írás] → [8 Benyújtás]
   └────────────── végig: ToDo · Research Log · Konzulensi digest · Notifikáció · Cost ──────────────┘
```

A stage-ek nem szigorúan lineárisak (vissza lehet lépni, párhuzamosan futhatnak), de a projekt egy
„current stage"-et tart, ez hajtja a workspace-t és a KPI-kat.

---

## 1. Architektúra — 3 sík + Supabase gerinc

A no-build böngészős app **nem tárolhat titkokat** és **nem futtathat hosszú/GPU-s munkát**. Ezért:

| Sík | Mi fut ott | Miért |
|---|---|---|
| **Böngésző (Publify)** | UI, állapot, Supabase kliens (RLS) | felhasználói felület |
| **Edge Functions (Deno)** | titkos API-proxy (Claude/Elicit/Consensus), rövid orchestráció, auth-ellenőrzés, **napi cron digest** | a kulcsok csak itt élnek; a böngésző sosem látja |
| **Central Compute Worker(ek)** | hosszú jobok, GPU, dataset-letöltés, agentic pipeline | Edge time-limitet meghaladó számítás; a thesis H1–H8 típusú futások helye |

**Supabase gerinc:** Postgres (entitások + RLS) · Storage (fájl/dataset/eredmény) · Realtime
(job-státusz, notifikáció) · Auth · pg_cron / Edge-cron (digest).

**A compute-offload mintája (a felhasználó kulcskérése):**
```
böngésző → research_jobs INSERT (queued)         ── a job specje a DB-ben
worker   → poll/realtime → futtat → Storage-be ír eredményt → job UPDATE (done, result_path, cost)
böngésző → Realtime értesül → eredmény-viewer     ── nincs böngészős számítás, nincs kiszivárgó kulcs
```

A worker a **service-role** kulccsal ír vissza (RLS bypass, de csak a worineteg él vele); a böngésző
és az Edge sosem.

---

## 2. Stage-ek és feature-ök (a teljes set)

### Stage 0 — Project setup
- Új kutatási projekt: cím, terület, kulcsszavak, célkitűzés, várható kimenet (cikk/szabadalom/thesis-fejezet).
- Kötés: PhD-hallgatóhoz (`phd_students`) + konzulens(ek)hez (`phd_supervisions`).
- Sablonok: „empirikus", „szisztematikus review", „módszertani", „healthcare/clinical" (a thesis témái).
- Láthatóság/RLS: tulajdonos + elfogadott konzulensek + admin.

### Stage 1 — Ötlet / téma-felfedezés
Négy bemenet, közös kimenet (rangsorolt **kutatási kérdés + hipotézis + indoklás + novelty-score**):
1. **Eddigi publikációk alapján** — a User Publify-publikációiból kiindulva: kiterjesztés/rés-keresés.
2. **Saját ötlet** — szabad szöveg → strukturált hipotézissé formálás (Claude, Edge).
3. **Automatikus Research Gap Analysis** — Claude agentic + Consensus/OpenAlex/Elicit retrieval →
   irodalmilag megalapozott rés-térkép, novelty-becslés, „mit nem csináltak még".
4. **Consensus API** — állítás/evidencia-keresés, „mennyire konszenzusos egy claim".
- Kimenet: `research_ideas` (candidate/selected/rejected), a kiválasztott hipotézis hajtja a tervet.

### Stage 2 — Irodalomkeresés & review
- **Claude Agentic Workflow** (több lépés): query-tervezés → fan-out több forráson → dedup →
  screening (befogad/kizár kritériumok) → strukturált extrakció (PICO/claim/módszer/minta) →
  szintézis-mátrix → review-vázlat. (A workflow-mintázat, amit az ultracode-nál is láttál.)
- **Elicit API** — szisztematikus keresés + strukturált oszlop-extrakció.
- **További források:** OpenAlex, Semantic Scholar, arXiv, PubMed, Crossref.
- Kimenet: szűrt, dedupolt **library** + extrakciók + szintézis; BibTeX export (Stage 7); opcionális
  **Obsidian-wiki ingest** (a meglévő wiki-skilljeid).

### Stage 3 — Kutatási terv / protokoll
- Hipotézisek formalizálása, változók, módszertan, tervezett analízisek, **power-analízis**.
- **Pre-registráció** sablon, **Data Management Plan (DMP)**.
- **Etika** — kötés a PhD-modul `ethics_status`-ához; healthcare threat-model sablon (thesis _shared_healthcare).

### Stage 4 — Adatszerzés
- **User feltöltés** — fájlok → Supabase Storage (már létező pubfiles-infra általánosítása).
- **Automatikus platform-letöltés** — connector-receptek ismert repókhoz: HuggingFace, Kaggle, Zenodo,
  OpenML, OSF, figshare, UCI, PhysioNet, és a thesis-specifikus nuScenes/BDD100K/PUG. A worker tölti le,
  Storage-be teszi, `research_datasets`-be jegyzi (méret, licenc, provenance, hash).
- **Adatlicenc + PII** kezelés (healthcare-nél kötelező).

### Stage 5 — Számítás (compute offload — a központi szerver)
- **Compute-igényes lépések azonosítása**: a pipeline-lépéseknél a platform megjelöli, mi fut böngészőn
  kívül (preprocessing, tréning, sweep, nagy elemzés).
- **Job-queue** (`research_jobs`): a böngésző beküld egy job-specet (script/notebook/pipeline + paraméterek
  + dataset-referencia); a **központi worker** futtatja; eredmény + log + költség **vissza a platformra**.
- Reprodukálhatóság: minden run rögzíti az inputokat, kód-verziót, környezetet, seed-et (thesis-szellem).
- Ide illeszkednek a thesis H1–H8 típusú scriptek mint job-sablonok.

### Stage 6 — Elemzés & eredmények
- **Eredmény-artifactok** (CSV, ábra, metrika) verziózva, `research_artifacts` (provenance-gráf: melyik job, mely inputból).
- Statisztikai elemzés, tábla/ábra-generálás, eredmény-viewer (a böngészőben).
- AI-asszisztens: elemzés-javaslat → script (Stage 5 worker) → eredmény-interpretáció.

### Stage 7 — Írás (LaTeX editor)
- A **meglévő LaTeX editor** a választott eredmények alapján támogatja a cikket:
  - **Grounded AI-drafting**: a projekt library-jából + eredményeiből (nem hallucináció).
  - **BibTeX** a `research_sources`-ból; **ábra/tábla** a `research_artifacts`-ból.
  - Szekció-vázlatok, koherencia-ellenőrzés, reviewer-szimuláció.
- **Folyóirat-választás** (scope-match a thesis publikációs tapasztalataiból), formázás, submission-csomag.

### Stage 8 — Benyújtás
- Submission package (PDF + forrás + cover letter + supplementary), verziókövetés, revízió-kezelés.
- Kész manuscript → a User **publikációi** közé (meglévő publications-infra).

---

## 3. Keresztmetszeti feature-ök (végig minden stage-en)

- **ToDo / Task management** — kanban a projektre; a PhD `phd_tasks` kiterjesztése `project_id`-vel.
- **Research Log** — auto (job done, artifact, döntés) + manuális bejegyzések; a thesis RLOG-séma
  (PROMPT/ARTIFACT/TASK/RESULT/DECISION/MILESTONE) általánosítása `research_log` táblába.
- **Konzulensi napi digest (kiemelt kérés)** — napi cron (Edge/pg_cron) összegzi a hallgató **előző napi**
  research_log-bejegyzéseit + job-eredményeit + mérföldköveit → konzulensenként egy digest → in-app
  notifikáció + e-mail. A meglévő `phd_supervisions` relációra épül; cadence állítható.
- **Notifikációk** — `notifications` tábla, Realtime; job kész, kérés, határidő, digest.
- **Provenance / reprodukálhatóság** — minden artifact a forrásaihoz láncolva (export: „repro bundle").
- **Cost / credit** — AI + compute költség projektenként; drága job előtt becslés + megerősítés; a profil
  usage-oldalán összegezve.
- **Kollaboráció** — több user, kommentek, szerepek (a supervision-modell kiterjesztése).

---

## 4. Adatmodell (új Supabase táblák, RLS-szkópolt)

| Tábla | Kulcsmezők | RLS |
|---|---|---|
| `research_projects` | owner_id, student_id?, title, field, keywords[], stage, status, goal | owner + konzulensek + admin |
| `research_ideas` | project_id, source[own\|pubs\|gap\|consensus], question, hypothesis, rationale, novelty, status | projekt-szkóp |
| `research_sources` | project_id, doi, title, authors, year, venue, abstract, source_api, screening, extraction(jsonb), pdf_path, dedup_key | projekt-szkóp |
| `research_datasets` | project_id, name, source, uri, size, license, local_path, provenance, hash, status | projekt-szkóp |
| `research_jobs` | project_id, type[download\|compute\|agentic\|analysis], spec(jsonb), status, progress, result_path, logs, compute_target, cost, created_by | projekt-szkóp; worker: service-role |
| `research_tasks` | project_id, title, status, due, assignee (vagy phd_tasks + project_id) | projekt-szkóp |
| `research_log` | project_id, profile_id, ts, type, summary, refs[] | projekt-szkóp (konzulens olvas) |
| `research_artifacts` | project_id, kind[figure\|table\|csv\|model\|draft], path, produced_by_job, version, inputs[] | projekt-szkóp |
| `notifications` | recipient_id, kind, payload(jsonb), read_at | címzett |
| `manuscripts` | project_id, latex_doc_ref, journal_target, status | projekt-szkóp |

Minden RLS-helper a PhD-modul mintáját követi (`phd_owns_student`, `phd_can_read/write_student`,
`is_admin()`), kiegészítve `research_can_read/write_project(project_id)`-vel (owner ∨ elfogadott
konzulens ∨ admin).

---

## 5. AI / agentic réteg

- **Idea/Gap engine** — Claude (server) + Consensus/OpenAlex/Elicit retrieval → megalapozott rés-analízis,
  novelty-score, kérdés-generálás.
- **Literature agent** — több lépéses pipeline (terv → fan-out → dedup → screen → extract → szintézis →
  draft), az orchestrátoron futva.
- **Writing assistant** — a projekt library-jára + eredményeire grounded, a LaTeX editorban.
- **Analysis assistant** — elemzés-javaslat + script-generálás (Stage 5 worker) + interpretáció.
- Közös elvek: **minden AI grounded + provenance-logolt + cost-trackelt; kulcs csak szerveroldalon.**

---

## 6. Biztonság / költség / adatvédelem

- Kulcsok kizárólag Edge/worker secret; **soha böngésző**.
- Projekt/user szintű **budget-cap** AI-ra és compute-ra; drága művelet előtt becsült költség + megerősítés.
- Worker **sandbox** + resource limit; job-audit.
- Dataset-licenc + provenance betartatása; **PII/healthcare** külön kezelés (anonimizálás, hozzáférés-napló).
- Rate-limit, audit-log, RLS-izoláció (a PhD-modulnál már élő mintázat).

---

## 7. Fázis-roadmap (mindegyik önállóan szállít, mint a PhD-modul)

| Fázis | Tartalom | Külső függés |
|---|---|---|
| **R0 — Foundation** | `research_projects` + workspace-shell (stage-stepper) + `research_log` + tasks (phd_tasks reuse) + `notifications` + RLS | nincs (tiszta Supabase+UI — **most építhető**) |
| **R1 — Irodalom & ötlet** | első **Edge Function** proxy; Consensus/OpenAlex keresés; library + screening; ötlet-capture + gap-analízis (Claude/Edge) | Edge + Claude/Consensus kulcs |
| **R2 — Digest & notifikáció** | napi konzulensi digest (cron) + in-app notifikáció + e-mail | Edge cron + e-mail provider |
| **R3 — Adat** | feltöltés (Storage) + automatikus dataset-letöltés (worker connectorok) + provenance | worker |
| **R4 — Compute offload** | job-queue + központi worker; beküldés/követés/visszaérkeztetés; eredmény-viewer | worker infra (a nagy darab) |
| **R5 — Agentic irodalom** | teljes több lépéses Claude pipeline (Elicit+Consensus+extrakció+szintézis) | Elicit kulcs + orchestrátor |
| **R6 — Írás-integráció** | LaTeX editor grounded a library-re/eredményekre; BibTeX; ábrák; AI-drafting; submission | — (meglévő editor + R1/R6 adat) |
| **R7 — Polish** | cost-dashboard, kollaboráció, sablonok, repro-export | — |

Természetes kezdés: **R0** (külső függés nélkül, azonnal építhető), majd R1 + R2 (az „értesítés a
konzulensnek" kérés ide esik), aztán a compute-infra (R3/R4).

---

## 8. Nyitott döntések (ezek a te hívásaid — ezek határozzák meg a kezdést)

1. **Központi compute hol fut?** (a) self-hosted worker a saját géped/VM/GPU-d (a thesis H1–H8 már lokálisan fut)
   · (b) mindig-on kis VM + queue · (c) serverless GPU (Modal/Replicate/RunPod). → költség & komplexitás.
2. **API-kulcs modell?** platform-kulcs (Edge secret, kvótával) vs. **BYOK** (mindenki a saját kulcsát hozza, titkosítva). MVP-re valószínűleg platform-kulcs + kvóta.
3. **Edge Functions bevezetése OK?** ez az első szerveroldali kód a no-build projektben (a titkokhoz kell).
4. **Hol kezdjünk?** R0 foundation a default; vagy előrevennéd az irodalom/digest részt.
5. **Most építsünk, vagy csak a design?** a design kész — szólj, ha R0-t kezdem.
