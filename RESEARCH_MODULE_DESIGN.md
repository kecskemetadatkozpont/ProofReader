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

## 8. Döntések (eldöntve — 2026-06-20)

1. **Kezdés:** ✅ **R0 Foundation** — külső függés nélkül, azonnal építhető (mint a PhD-modul).
2. **Központi compute:** ✅ **Self-hosted worker** (saját gép / VM / GPU; a thesis H1–H8 már lokálisan fut).
   A `research_jobs` queue ehhez tervezve; a worker service-role kulccsal poll-ozza a queue-t és ír vissza.
3. **API-kulcs modell:** ✅ **Platform-kulcs + kvóta** — közös kulcs Edge-secretként, per-user/projekt
   kvótával és cost-trackinggel; a böngésző sosem látja.
4. **Edge Functions:** bevezetjük (R1-től), a titkos API-proxyhoz — az első szerveroldali kód a projektben.

### R0 build-scope — ✅ KÉSZ (deployed + verified)
- **migration-11-research.sql:** `research_projects`, `research_log`, `research_tasks`, `notifications`
  + RLS + `research_can_read/write_project()` helper (owner ∨ elfogadott konzulens ∨ admin). FUTOTT.
- **migration-12-research-rls-fix.sql:** a `research_projects` saját read/update policy-je a sor `owner_id`-ját
  olvassa közvetlenül (+ `research_supervises(sid)` helper a konzulens-ellenőrzéshez) — különben az
  `INSERT … RETURNING` (.select()) 42501-be futott a STABLE függvény snapshotja miatt. FUTOTT.
- **Research.html + research.jsx:** projekt-lista + létrehozás; projekt-detail **9-állomásos stage-stepperrel**
  + Overview + **Research Log** (típusos bejegyzés) + **Tasks** (todo/doing/done). PhD-modul shell/RLS-minta.
- **Drawer + admin-fejléc Research-link**; admin **View as** ide is kiterjed.
- **Tesztek:** shell smoke 7/7 · élő RLS 8/8 (owner ír; konzulens read-only; idegen nem lát) · UI create+log 5/5.

### R2 build-scope — ✅ KÉSZ (deployed + verified)
- **migration-13-research-digest.sql:** `build_research_digests(for_day)` supervisoronként egy digestbe rakja
  a hallgatók előző napi `research_log`-ját (idempotens (supervisor, day)); `run_research_digests_yesterday()`;
  opcionális **pg_cron** (05:00 UTC, magától települ ha a pg_cron él). Tisztán SQL — nincs külső kulcs. FUTOTT.
- **research.jsx NotifBell:** értesítés-csengő (olvasatlan-szám + popover); a digest renderelve (nap · N hallgató,
  M frissítés), kibontható tételekkel, mark-one/all read.
- **Tesztek:** backend 9/9 (digest létrejön, recipient-only RLS, tartalmazza a log-bejegyzést, idempotens) ·
  UI 3/3 (csengő badge, digest-popover, kibontás).

### R1 build-scope — ✅ KÉSZ (UI deployed + verified; AI gap = Edge, user-deploy)
- **migration-14-research-lit-ideas.sql:** `research_ideas` + `research_sources` + RLS. FUTOTT.
- **research.jsx:** projekt-detail **fülek** (Overview · Ideas · Literature · Log · Tasks); **Ideas** (saját
  kérdés/hipotézis + ✨ Gap analysis gomb); **Literature** = **OpenAlex** keresés (kulcs nélkül, böngészőből) →
  Library include/maybe/exclude screeninggel; absztrakt az inverted-indexből; dedup OpenAlex-id alapján.
- **backend/functions/research-ai (Deno):** biztonságos Claude-proxy (a kulcs Edge-secret) — a user deployolja
  (`backend/functions/README.md`). Enélkül minden más megy, a gomb „AI not configured"-ot ír.
- **Tesztek:** backend RLS 9/9 (owner ír idea+source; konzulens read-only) · UI 5/5 (idea felvétel, valós OpenAlex
  keresés + Library-be tétel).

### R3 + R4 + R6 build-scope — ✅ KÉSZ (UI deployed; **migration-15 futtatása vár**)
- **migration-15-research-data-jobs.sql:** `research_datasets` + `research_jobs` + RLS; **`research-data`
  Storage bucket** + path-szkópolt policy-k (`safe_uuid()` guarddal). ⚠️ **a usernek le kell futtatnia.**
- **R3 — Data tab:** külső dataset regisztráció (url/huggingface/kaggle/zenodo/openml) **vagy fájl-feltöltés**
  a research-data bucketbe (projektre szkópolva); státusz-lista.
- **R4 — Compute tab:** job-queue (`python` snippet / `stats` dataseten / `download`); státusz, progress,
  kibontható result+logs, cancel/delete. **+ `worker/research_worker.py`** (stdlib-only self-hosted worker):
  pollozza a queue-t a service-kulccsal, futtat, visszaír; optimista job-claim; kész job → `research_log`
  RESULT (a digestbe is). README + cron-útmutató. **Pure executorok unit 6/6.**
- **R6 — Writing tab:** `.tex` skeleton (kiválasztott ötlet → abstract, included library → `\cite`, kész
  eredmények → Results) + `library.bib` (egyező, dedupolt kulcsok, unit-verifikálva) + LaTeX-editor link.
- **BibTeX export** a Library-ből (included vagy mind), dedupolt AuthorYear kulcsokkal.
- **Stage-léptetés** mostantól `research_log` MILESTONE-t ír (a digestbe is).
- **Tesztek (migration-15 nélkül futtatható rész):** shell smoke 7/7 · R1/R2 UI regresszió 8/8 (új fülök
  gracefully degradálnak) · worker pure 6/6 · tex/bib kulcs-invariáns ✓. **R3/R4 élő e2e (8 assert) a
  migration-15 lefuttatása után fut** (`/tmp/aloud_research_r3r4_e2e.js`: regisztrál → queue → worker fut → eredmény).
- **Hátra:** R5 (agentic Elicit+szintézis) · R7 (cost-dashboard, kollaboráció) · a `research-ai` Edge-deploy +
  pg_cron a usernél.

## 9. R5b — Ideas chat (Consensus-szal, MCP-n keresztül) — DESIGN

> Cél: az Ideas fül tetején egy **chat-ablak**, ahol a user egy **Claude-session**-nel beszélget, és Claude
> a **Consensus**-t hívja tudományos evidenciáért (MCP-n vagy direkt tool-on át), hogy megalapozott
> kutatási kérdéseket csiszoljanak. Az asszisztens-üzenetekből „✚ Save as idea" → `research_ideas`.

### Architektúra (a kulcs sosem a böngészőben)
```
Böngésző chat-UI (Ideas fül)
  → research-chat backend (Edge Function VAGY self-hosted worker)   ── itt él az Anthropic + Consensus kulcs
      → Anthropic Messages API (streaming), agentic tool-use loop:
          Claude → consensus_search hívás → backend lekéri Consensus-t → tool_result → Claude → …
      ← SSE token-stream vissza a böngészőbe
  ↘ minden üzenet perzisztálva: research_chats + research_messages (RLS: owner + konzulens + admin)
```

### Consensus bekötése — két út
- **(A) Direkt tool (egyszerűbb, ajánlott MVP-re):** a backend definiál egy `consensus_search(query)` Claude-toolt,
  és amikor Claude meghívja, a backend a **Consensus REST API**-t kéri le, az eredményt tool_result-ként adja
  vissza. Teljes kontroll, nincs MCP-plumbing. Funkcionálisan azonos a „Consensus-szal beszélgetni" céllal.
- **(B) Anthropic MCP-connector:** a Messages API natívan csatlakozik egy **távoli (URL-alapú) MCP-szerverhez**
  (`mcp_servers: [{type:'url', url: CONSENSUS_MCP_URL, authorization_token}]`, `betas:['mcp-client-…']`).
  Ehhez Consensusnak **remote (HTTP/SSE) MCP-szervert** kell adnia — ha csak stdio/npm MCP van, akkor a
  backendnek saját MCP-klienst kell futtatnia (Edge-en nehéz → inkább a self-hosted worker).

### Backend-runtime — két út
- **Edge Function:** egyszerű, streamel, de időkorlátos (hosszú agentic chat kifuthat belőle).
- **Self-hosted worker:** nincs időkorlát, illik a választott compute-modellhez, tud MCP-klienst futtatni;
  cserébe a streaminghez Realtime/WS-plumbing kell.

### Adatmodell (új, RLS a research_can_read/write_project mintára)
- `research_chats(id, project_id, title, created_at)`
- `research_messages(id, chat_id, role[user|assistant|tool], content, tool_calls jsonb, created_at)`
- „Save as idea" → `research_ideas(source='consensus')`.

### Kulcsok / kvóta
Anthropic platform-kulcs + **Consensus API-kulcs** (mindkettő Edge/worker secret). Agentic = több Claude-hívás/üzenet
→ kvóta/cost-tracking (R7). MVP: platform-kulcs + projekt-szintű napi limit.

### Fázis (MVP → teljes)
- **C1:** Edge `research-chat` + direkt `consensus_search` tool + streaming + perzisztált chat + „Save as idea".
- **C2:** MCP-connector (ha Consensus remote MCP-t ad), Elicit/OpenAlex tool-ok hozzáadása.
- **C3:** worker-runtime a hosszú session-ökhöz + cost-dashboard.

### Nyitott döntések
1. Consensus bekötése: **direkt tool (REST)** vs **MCP-connector** (utóbbi remote MCP-URL-t igényel).
2. Runtime: **Edge Function** vs **self-hosted worker**.
3. Van **Consensus API-kulcsod** (ill. remote MCP-URL)? Ez gate-eli az építést.
