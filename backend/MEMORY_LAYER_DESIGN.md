# Publify Memory — Decision-Grade Design Recommendation

**A Postgres-native, LLM-maintained knowledge graph, built inside the Supabase you already run.**

Author: Technical Architect · Date: 2026-07-05 · Status: recommended for build

---

## 1. TL;DR recommendation

**Build a Postgres-native knowledge graph — two core tables (`km_nodes` + `km_edges`) plus a split-out `km_embeddings` (pgvector) table — that lives inside Publify's existing Supabase database, is fed by the autonomous runner distilling every completed `research_protocol_steps.result` into typed nodes/edges, is retrieved by a hybrid vector + full-text + 2-hop-graph RPC, and is surfaced as a `force-graph` "Map" tab sitting on top of a faceted/semantic search list.** No second database, no Python memory framework, no markdown files. This is the *only* option that satisfies all four hard constraints simultaneously: it runs entirely on Supabase Postgres/PostgREST/RLS (no external graph DB — Apache AGE is not available on Supabase managed, and Neo4j/Zep/Graphiti all require a store you don't have); it needs no build step (the UI is one self-hosted UMD `<script>` + `h()` components, retrieval is PostgREST RPCs); it *reuses* the `research_*` schema as its immutable source layer rather than replacing it; and every schema object is plain DDL you paste into the SQL Editor (which is all your `sb_secret_` key permits anyway). The design steals the *semantics* of Karpathy's LLM-Wiki — compile-knowledge-once-and-maintain-it, index-first retrieval, contradiction edges, file-answers-back, a periodic lint pass — and rejects only its *substrate* (flat files), because Publify is multi-user, concurrent, and RLS-scoped, which files cannot serve.

---

## 2. What the Karpathy gist teaches us — and how it shapes the design

The [gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) is the "LLM Wiki": replace stateless RAG (which "rediscovers knowledge from scratch on every question — there's no accumulation") with a **persistent, compounding artifact** an LLM incrementally builds and maintains. Its core claims, and the design decision each one forces:

| Gist teaching | Design consequence for Publify |
|---|---|
| **Three layers**: immutable *raw sources* → LLM-owned *wiki* → human/LLM *schema* (conventions). | `research_protocols` / `research_protocol_steps` / `research_files` = the raw layer (read-only, never mutated). `km_*` graph = the wiki layer. The **ontology** (§4) + the extraction prompt = the schema layer, versioned in a config table. |
| **The bottleneck is bookkeeping, not reading/thinking** — LLMs "don't forget to update a cross-reference and can touch 15 files in one pass." | The runner (which already writes results asynchronously) does the write-side bookkeeping: one completed step → many nodes/edges updated. This is the whole justification for automating ingestion instead of asking users to tag. |
| **Ingest → Query → Lint** operations. | Becomes three runner jobs: an ingest job per completed step, a query RPC for humans + runner, a scheduled lint job (orphans, contradictions, stale findings, dedup review). |
| **Index-first retrieval** (read `index.md`, then drill in; embeddings skipped only because of "modest scale"). | We *upgrade* this: keep the discipline (cheap catalog filter first) but add pgvector — Supabase removes the scale constraint the gist worked around, so hybrid retrieval is a strict improvement, not a departure. |
| **Flag contradictions when a new source conflicts with prior claims.** | A first-class `contradicts` edge — the single highest-value gist idea for a *research* platform, because cross-project contradictions (your culture already tracks these: paper_10 `0.9282 → 0.9124`, P1 `0.972 → 0.711`) are exactly what admins want surfaced. |
| **File answers back so "explorations compound rather than disappear into chat history."** | The runner's *query-before-execute → file-result-back* loop (§3.4): prior findings are injected into a step's context, and the new result becomes new nodes/edges. Work compounds. |
| **`log.md` append-only, grep-parseable.** | A `km_log` table = provenance + a "recent activity" feed the UI needs anyway. |

**The one mismatch, and how we resolve it:** the gist assumes *single curator + single LLM + local files*. Publify is *multi-user, multi-project, concurrent, access-controlled, already in Postgres*. So the verdict is a **hybrid: LLM-Wiki behaviors on a graph substrate.** Steal every behavior above; store them as rows, not `.md`. (Notably, your own `CLAUDE.md §6` is already a Hungarian port of this pattern for the ThesisVault — the team already believes in it, so this is culturally aligned, not a new bet.)

---

## 3. Recommended architecture

Four layers. Each maps onto a gist operation and onto existing Publify machinery.

```
 RAW (immutable)            WIKI (LLM-maintained)                 SURFACING
 ────────────────           ─────────────────────                ──────────────────
 research_protocols   ─┐                                     ┌─▶ Map tab (force-graph)
 research_protocol_steps├─▶ INGEST ─▶ km_nodes / km_edges ──▶│─▶ Search tab (facets+RRF)
   .spec / .result     │   (runner)   km_embeddings          │─▶ Timeline (km_log)
 research_files        ─┘              km_communities (P3)    └─▶ AI runner reuse (RPC)
                            SCHEMA: km_ontology + extraction prompt (versioned)
```

### 3.1 Storage — DDL sketch (`km_*` coexisting with `research_*`)

Apply as a numbered migration (`migration-34-memory-km.sql`) via the SQL Editor. `km_nodes`/`km_edges` are the property graph; `km_embeddings` is split out so the heavy HNSW index is off the hot node table and a node can carry multiple model-tagged vectors.

```sql
-- ============================================================
-- Publify Memory Layer — knowledge graph over research_* tables
-- Apply via Supabase SQL Editor (sb_secret_ cannot run DDL over the wire)
-- ============================================================
create extension if not exists vector with schema extensions;  -- pgvector
create extension if not exists ltree;                          -- hierarchy paths
-- pgmq, pg_cron, pg_net: enable from the dashboard (embedding pipeline, §4.5)

-- 0. ONTOLOGY — closed vocabulary, editable so the schema can grow (§4.1)
create table public.km_ontology (
  id smallint generated always as identity primary key,
  kind text not null check (kind in ('node','edge')),
  name text not null,                    -- 'method' | 'contradicts' | ...
  description text,
  unique (kind, name)
);

-- 1. NODES — the "wiki pages" / graph vertices
create table public.km_nodes (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,            -- finding|method|dataset|metric|paper|
                                         -- hypothesis|entity|tool|protocol|step|result
  title        text not null,
  body         text,                     -- distilled markdown = the karpathy "page body"
  -- provenance → the immutable research_* source layer
  project_id   uuid references public.projects(id) on delete cascade,
  protocol_id  uuid references public.research_protocols(id) on delete set null,
  step_id      uuid references public.research_protocol_steps(id) on delete set null,
  source_kind  text,                     -- which research_* table it was distilled from
  path         ltree,                    -- project.protocol.step.node containment path
  -- ownership / sharing (§6)
  created_by   uuid not null references auth.users(id) default auth.uid(),
  visibility   text not null default 'project'
                 check (visibility in ('private','project','org','public')),
  props        jsonb not null default '{}',   -- metric values, tags, urls, numeric fields
  is_canonical boolean not null default true, -- false once merged (entity resolution)
  merged_into  uuid references public.km_nodes(id) on delete set null,
  fts          tsvector generated always as
                 (to_tsvector('simple',                     -- 'simple' = mixed HU/EN safe
                    coalesce(title,'') || ' ' || coalesce(body,''))) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.km_nodes using gin  (fts);
create index on public.km_nodes using gist (path);
create index km_nodes_project_idx on public.km_nodes(project_id);
create index km_nodes_kind_idx    on public.km_nodes(kind);

-- 2. EDGES — typed, directed, BITEMPORAL (Graphiti idea: supersede, never delete)
create table public.km_edges (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.km_nodes(id) on delete cascade,
  target_id      uuid not null references public.km_nodes(id) on delete cascade,
  rel            text not null,          -- uses|produces|measures|supports|contradicts|
                                         -- derived_from|authored_by|part_of|depends_on|
                                         -- evaluates|cites|same_as|similar_to
  weight         real not null default 1.0,  -- confidence; bumped on reuse (memify, §7 P3)
  evidence       text,                   -- source sentence / justification
  source_step_id uuid references public.research_protocol_steps(id) on delete set null,
  project_id     uuid references public.projects(id) on delete cascade,  -- denorm for RLS
  created_by     uuid not null references auth.users(id) default auth.uid(),
  valid_from     timestamptz not null default now(),  -- event time (when fact became true)
  valid_to       timestamptz,                         -- null = still valid; set on supersede
  observed_at    timestamptz not null default now(),  -- ingest time
  props          jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  unique (source_id, target_id, rel, valid_from)
);
create index km_edges_source_idx on public.km_edges(source_id);
create index km_edges_target_idx on public.km_edges(target_id);
create index km_edges_rel_idx    on public.km_edges(rel);
create index km_edges_live_idx   on public.km_edges(source_id) where valid_to is null;

-- 3. EMBEDDINGS — 1..N vectors per node, model-tagged (default: OpenAI 3-small, §4.5)
create table public.km_embeddings (
  id           uuid primary key default gen_random_uuid(),
  node_id      uuid not null references public.km_nodes(id) on delete cascade,
  model        text not null default 'text-embedding-3-small',
  dim          int  not null default 1536,
  content_hash text not null,           -- skip re-embedding unchanged text
  embedding    extensions.vector(1536), -- ONE dim per HNSW column — pick at rollout (§8)
  project_id   uuid references public.projects(id) on delete cascade,  -- denorm for RLS
  visibility   text not null default 'project',                        -- mirrors the node
  created_at   timestamptz not null default now(),
  unique (node_id, model)
);
create index km_emb_hnsw     on public.km_embeddings using hnsw (embedding vector_ip_ops);
create index km_emb_node_idx on public.km_embeddings(node_id);

-- 4. ALIASES — entity-resolution provenance: keep every surface mention (§4.4)
create table public.km_aliases (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.km_nodes(id) on delete cascade,
  mention text not null,                -- 'BDD-100k' merged into canonical 'BDD100K'
  source_step_id uuid references public.research_protocol_steps(id) on delete set null,
  created_at timestamptz not null default now()
);
create index km_aliases_node_idx on public.km_aliases(node_id);

-- 5. LOG — karpathy's append-only log.md → recent-activity feed + audit trail
create table public.km_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor uuid references auth.users(id), -- null = the runner / service role
  op text not null,                     -- ingest|query|lint|merge|supersede
  node_id uuid references public.km_nodes(id) on delete set null,
  note text
);
create index km_log_ts_idx on public.km_log(ts desc);

-- 6. COMMUNITIES — Phase 3 only: cross-project "global" summaries (§7)
create table public.km_communities (
  id uuid primary key default gen_random_uuid(),
  level int not null, parent_id uuid references public.km_communities(id) on delete set null,
  member_ids uuid[] not null default '{}',
  title text, report text,              -- LLM-written community report
  embedding extensions.vector(1536),
  created_at timestamptz not null default now()
);
```

Rationale for the non-obvious choices: **plain tables, not Apache AGE** — AGE is not installable on Supabase managed (its Postgres images are Nix-sandboxed, AGE is C and not a Trusted Language Extension; the documented "fix" is a second database, which forfeits RLS/PostgREST unification — [discussion #40285](https://github.com/orgs/supabase/discussions/40285), [#13263](https://github.com/orgs/supabase/discussions/13263)). **HNSW not IVFFlat** — HNSW builds on an empty table and tolerates continuous inserts; IVFFlat must be retrained after growth, wrong for an accreting graph ([HNSW docs](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)). **`ltree path`** gives "everything under this project" as one indexed `path <@ 'proj_x'` instead of a recursive CTE. **Bitemporal edges** (`valid_from`/`valid_to`/`observed_at`) are two timestamp columns, no graph DB needed, and directly serve provenance: a superseded finding's edge gets its window closed, never deleted.

### 3.2 Retrieval — hybrid vector + FTS + graph

Three PostgREST-callable RPCs. Reads never invoke an LLM (all extraction cost is paid at write time), keeping the GitHub-Pages UI fast.

```sql
-- (a) Hybrid search: Reciprocal Rank Fusion of FTS + vector (Supabase official recipe)
create or replace function public.km_hybrid_search(
  query_text       text,
  query_embedding  extensions.vector(1536),
  match_count      int    default 20,
  full_text_weight real   default 1.0,
  semantic_weight  real   default 1.0,
  rrf_k            int    default 50,
  filter_project   uuid   default null,
  filter_kinds     text[] default null
) returns setof public.km_nodes language sql stable as $$
  with full_text as (
    select n.id, row_number() over (order by ts_rank_cd(n.fts,
             websearch_to_tsquery('simple', query_text)) desc) as rank
    from public.km_nodes n
    where n.fts @@ websearch_to_tsquery('simple', query_text)
      and (filter_project is null or n.project_id = filter_project)
      and (filter_kinds is null or n.kind = any(filter_kinds))
    limit match_count * 2
  ),
  semantic as (
    select e.node_id as id, row_number() over (order by e.embedding <#> query_embedding) as rank
    from public.km_embeddings e
    join public.km_nodes n on n.id = e.node_id
    where (filter_project is null or e.project_id = filter_project)
      and (filter_kinds is null or n.kind = any(filter_kinds))
    limit match_count * 2
  )
  select n.* from public.km_nodes n
  join (
    select coalesce(ft.id, s.id) as id,
           coalesce(1.0/(rrf_k + ft.rank),0)*full_text_weight
         + coalesce(1.0/(rrf_k + s.rank),0)*semantic_weight as score
    from full_text ft full outer join semantic s on ft.id = s.id
  ) ranked on ranked.id = n.id
  order by ranked.score desc
  limit match_count;
$$;

-- (b) Cycle-safe k-hop subgraph expander (for node detail + runner context)
create or replace function public.km_subgraph(root uuid, max_hops int default 2)
returns table(id uuid, title text, kind text, depth int) language sql stable as $$
  with recursive walk as (
    select n.id, n.title, n.kind, 0 as depth, array[n.id] as path
    from public.km_nodes n where n.id = root
    union all
    select n2.id, n2.title, n2.kind, w.depth+1, w.path || n2.id
    from walk w
    join public.km_edges e on (e.source_id = w.id or e.target_id = w.id) and e.valid_to is null
    join public.km_nodes n2 on n2.id = case when e.source_id = w.id then e.target_id else e.source_id end
    where w.depth < max_hops and not n2.id = any(w.path)   -- cycle guard
  )
  select distinct id, title, kind, depth from walk order by depth;
$$;
```

Retrieval is **dual-level** (LightRAG's idea): low-level = `km_hybrid_search` over entity/finding nodes; high-level (Phase 3) = the same fusion over `km_communities.report` for "what has the group learned about OOD across all projects." PostgREST vector operators aren't exposed directly, so both go through these `rpc()` functions — and because the functions are `security invoker`, **RLS composes automatically**: a caller only ever fuses rows they may read.

### 3.3 Surfacing

Two consumers of the same graph: **humans** get the Map tab + faceted/semantic search + timeline (§5); the **AI runner** gets the reuse loop (§3.4). The data endpoint is a single `km_graph(project_id?, kinds[]?)` RPC returning `{nodes, edges}` already RLS-filtered — the client renders exactly what it's handed and never sees a hidden node.

### 3.4 AI-runner reuse — the loop that makes work compound

This is the goal that pays for the whole layer. It wraps the existing runner:

1. **Before executing** a step, the runner calls `km_hybrid_search` seeded from `spec.instruction` + `spec.inputs` (datasets/methods named there), then `km_subgraph` on the top hits, and injects the matching prior findings + their metrics into the step's context ("this dataset was already processed in project X; Mahalanobis scored 0.788 there").
2. **After executing**, the runner distills the new `result` into nodes/edges (§4) and appends to `km_log`. Explorations compound instead of disappearing — the gist's "file answers back," made concrete.

---

## 4. Ingestion pipeline

Publify's decisive advantage over generic GraphRAG: **half the graph is already semi-structured** in `research_protocol_steps`. So ingestion is a **hybrid** — deterministic edges straight from columns (no LLM), plus schema-constrained LLM extraction only from the free-text `report`/`summary`.

### 4.1 Trigger
An `AFTER UPDATE` trigger on `research_protocol_steps` fires when `status` flips to `done` (or, if `needs_approval`, when approved) → enqueues a `distill` job into **pgmq**. The autonomous **runner** drains that queue (it already holds the LLM keys and runs async — keep LLM logic there, not scattered across Edge Functions). A DB trigger (not a runner-side hook) is chosen so human edits to a result also re-ingest.

### 4.2 Deterministic pass (no LLM) — from existing columns
- Nodes: `Protocol` (from `research_protocols`), `Project`, `Person` (from `profiles`), one `Step` per row, `Result` per completed step with a `result.summary`.
- Edges: `Step —part_of→ Protocol —part_of→ Project`; `Step —depends_on→ Step` (straight from `depends_on` — you already store this DAG); `Protocol/Step —authored_by→ Person` (from `assignee`, tagging ai vs human).
- From `spec`: `inputs` → `Dataset`/`Artifact` nodes + `uses` edges; `command_hint` → `Tool` node; `expected_outputs` → provisional `Artifact` nodes.
- From `result`: `artifacts[]`/`figures[]` → `Artifact` nodes + `produces` edges; each `metrics{}` key → one `Metric` node (numeric value in `props`) + `produces` edge; `deviations` → attached as evidence.

### 4.3 LLM extraction pass — from `result.report` / `result.summary` / `spec.instruction`
**Schema-constrained** (ontology-guided) extraction against the closed vocabulary — this sharply cuts node fragmentation and hallucinated relation types versus open extraction. Strict-JSON output:

```json
{
  "entities":  [{"name": "...", "type": "method|dataset|finding|hypothesis|paper|metric|tool|entity",
                 "description": "...", "aliases": ["..."]}],
  "relations": [{"source": "...", "target": "...",
                 "predicate": "uses|produces|measures|supports|contradicts|derived_from|evaluates|cites",
                 "description": "...", "strength": 0.0, "evidence": "<source sentence>"}]
}
```

Reject or map any type outside the vocabulary. Use GraphRAG's **"gleaning"** (re-prompt "any entities missed?" for 1–2 rounds) to raise recall on dense reports. Every triple carries `evidence` + `source_step_id`. This mints the *semantic* nodes the columns can't (Method, Finding, Hypothesis) and the interpretive edges — including the payoff: `Finding —contradicts→ Finding` when a later run reverses an earlier metric.

### 4.4 Dedup / entity resolution (the part that makes it *shared* memory)
Resolve **at insert time** against existing nodes, streaming, no full rebuild:
1. **Block** with pgvector: embed `name + type + description`, ANN-fetch candidates of the **same type** only (never merge a `Metric` with a `Method`).
2. **Score**: string similarity (catches `BDD100K` ≡ `BDD-100k`) + embedding cosine (catches `Mahalanobis distance` ≡ `Mahalanobis OOD score`) + **graph-aware** shared-neighbor boost (same dataset/project/author).
3. **Act** (mem0's op model): emit `ADD / UPDATE(merge) / NOOP` — **auto-merge at cosine ≳ 0.92 *and* type-match**, **queue 0.82–0.92 for admin review** (this queue *is* the lint UI), distinct below. On merge, set `is_canonical=false` + `merged_into`, and keep every surface form in `km_aliases` with provenance (you must be able to explain a merge — RLS/audit).

### 4.5 Where embeddings are computed
**Not** in the client (would leak keys) and **not** inline (adds write latency). Use Supabase's official **automatic-embeddings** pattern: `AFTER INSERT/UPDATE` on `km_nodes` → `util.queue_embeddings()` into **pgmq** → **pg_cron** every ~10 s runs `util.process_embeddings()` in batches → **pg_net** POSTs to an **Edge Function** that embeds and writes back to `km_embeddings` ([automatic embeddings](https://supabase.com/docs/guides/ai/automatic-embeddings)). Model choice is **opinionated for Publify**: default to **OpenAI `text-embedding-3-small` (1536-dim)** because the substrate is Hungarian-dominant and the built-in `gte-small` is English-centric; cost is trivial (~$0.02/1M tokens → a full-platform backfill is *cents*). Keep `km_embeddings` model/dim-tagged so `gte-small` (free, in-region, private, [edge inference](https://supabase.com/blog/ai-inference-now-available-in-supabase-edge-functions)) remains a drop-in for English/privacy-sensitive content — but the HNSW-indexed production column is one dim; pick 1536 at rollout (§8).

---

## 5. Knowledge-map UI

**Recommended library: `force-graph` (vasturiano, vanilla).** One self-contained ~173 KB UMD file with d3-force already bundled, zero other runtime deps, Canvas 2D (no WebGL/WASM to trip the CSP), self-hostable next to your other assets — the exact profile a no-build/Babel-Standalone/GitHub-Pages/strict-CSP stack requires ([force-graph](https://github.com/vasturiano/force-graph)). It produces the organic "second-brain / Obsidian" look that reads intuitively as a knowledge map, and at Publify's realistic scale (100s–low-1000s of nodes) it's more than fast enough. **Upgrade path if analytics grow: Cytoscape.js** (zero deps, one UMD, ~112 KB gzip, native compound nodes for project→protocol→step nesting). **Avoid:** react-force-graph (drags React-as-UMD in), 3d-force-graph (three.js weight), AntV G6 (its value is tree-shaking under a bundler you don't have — you'd ship ~1 MB).

**Crucial framing decision: the graph sells the vision; search does the daily work.** A force-directed graph is great for exploration and serendipity, poor for "find the exact finding I need." So the Memory feature is *three* tabs over one substrate, not a graph alone:

- **Search tab (default):** faceted + semantic list over `km_hybrid_search` — the highest-hit-rate surface for reuse. Facets = project · user/assignee (ai vs human) · node-type chips · status · metric range.
- **Map tab:** `force-graph`, color/shape-coded by `kind`, with a left-rail of the same facets plus a **time brush** on `created_at` (watch the map accrete — the "compounding artifact" made visual) and a search box that dims non-matches and `centerOn`s hits.
- **Timeline tab:** reverse-chronological `km_log` feed — provenance and audit (mirrors your own `RESEARCH_LOG.md`/`PROJECT_HISTORY.drawio` habit).

**Per-project vs admin global view:**
- **Per-project (member):** graph pre-filtered to that project (RLS scopes the rows). Shared knowledge nodes (Method/Dataset/Paper) still render; edges to *other* projects appear as **ghost stubs** ("also used in 2 other projects") that reveal only counts, never restricted content.
- **Admin (global):** all projects + users overlaid, cross-project **bridge highlighting** (nodes shared across ≥2 projects — high betweenness), color-by-project to see silos vs. connections. Answers "where is knowledge duplicated, which methods/datasets are institutional assets, which projects are isolated."
- The boundary is enforced in the **`km_graph` RPC**, not the client: member → own projects + de-identified stubs; admin → everything.

**Node detail → task linkback (the whole point of tying memory to work):** click a node → right-hand `h()` panel. A `Result` node shows `result.summary`, key `metrics`, a `figures` thumbnail, `deviations`, "generated by runner / approved by \<user\>", and **"Open the step that produced this"** → deep-links to `/protocol/:id`. A `Method`/`Dataset`/`Paper` node shows an auto-generated mini-wiki page: one-line synthesis + **every protocol/result across all projects that touched it**. Every panel has **"Reuse in a new protocol"** → pre-fills a new `research_protocol_steps.spec` referencing this finding, feeding §3.4's loop.

---

## 6. RLS & cross-user knowledge sharing

Publify already ships **strict per-user isolation** (migrations 31/32/33). The knowledge graph is the one place that needs *selective* sharing — so model it explicitly, defaulting closed, never open.

```sql
alter table public.km_nodes      enable row level security;
alter table public.km_edges      enable row level security;
alter table public.km_embeddings enable row level security;

-- READ: owner OR public OR project-member OR admin(org)
create policy km_nodes_read on public.km_nodes for select using (
     created_by = auth.uid()
  or visibility = 'public'
  or (visibility = 'project' and project_id in (
        select project_id from public.project_members where user_id = auth.uid()))
  or (visibility = 'org' and public.is_admin(auth.uid()))
);
-- WRITE: owner only (runner writes as service role, stamping created_by from step context)
create policy km_nodes_write on public.km_nodes for all
  using (created_by = auth.uid()) with check (created_by = auth.uid());
```

Load-bearing RLS rules:
- **What's shared vs isolated:** `private`/`project` = isolated as today; `org`/`public` = the deliberate sharing surface. Cross-project discovery ("surface connections across users") is precisely `visibility IN ('org','public')` + an admin `is_admin()` read path — you deliver the global map *without* weakening the isolation you already shipped.
- **Denormalize `project_id` + `visibility` onto `km_edges` and `km_embeddings`** (done in the DDL) so their policies are a direct column check, not a per-row join back to `km_nodes` — RLS subqueries on every vector row get expensive.
- **Embeddings inherit node visibility** — the `km_embeddings` read policy must mirror the node's, or semantic search leaks vectors of hidden nodes.
- **The runner writes via the service role** (bypasses RLS) but **must stamp `created_by`/`project_id`/`visibility` from the initiating protocol's context** — never a blank owner (that's how you'd break isolation; your own memory notes flag that shared-DB writes need explicit provenance).
- **Cross-project `similar_to` edges** (born from vector search) are gated: only materialize between nodes *both* readable to the viewer, or compute them at query time under the viewer's RLS — otherwise an edge reveals the *existence* of another user's private node.

---

## 7. Phased rollout

Ordered cheapest-first, each phase shipping standalone value. Effort is focused-days for one engineer adapting published Supabase recipes.

| Phase | What ships | Effort | Unlocks |
|---|---|---|---|
| **P0 — Headless Memory API** | `km_*` schema + RLS + HNSW; automatic-embeddings pipeline; `km_hybrid_search` RPC. *No graph, no UI yet.* Embed existing `result.summary`/`report` as `Result`/`Finding` nodes via a one-time backfill. | **~3–4 days** | The runner can already **reuse prior findings** by semantic search (§3.4) — the single highest-ROI goal — before any graph exists. Also gives a "search past results" box in the current UI for near-zero extra cost. |
| **P1 — Ingestion / distillation** | The runner's distill job: deterministic edges from columns (§4.2) + schema-constrained LLM extraction (§4.3) + entity resolution (§4.4) + `km_log`. Trigger + pgmq wiring. | **~4–6 days** (the real work — extraction-prompt quality + edge heuristics) | The actual **graph accumulates**: Method/Dataset/Paper/Finding nodes and typed edges across projects. `contradicts` edges start flagging superseded results. |
| **P2 — Knowledge-map UI** | `km_graph` RPC; `force-graph` Map tab; faceted/semantic Search tab; node-detail panel with task linkback + "Reuse in a new protocol"; Timeline tab; per-project vs admin views. | **~1.5–2 weeks** (graph viz is the biggest UI lift) | Humans **navigate accumulated knowledge**; cross-project discovery via shared nodes/ghost stubs; admins see silos vs. bridges. |
| **P3 — Global memory + self-maintenance** | Scheduled lint job (orphans, stale findings, dedup review queue, contradiction surfacing); bitemporal supersession on re-ingest; **Leiden communities + LLM community reports** for high-level retrieval; memify edge-weight feedback on reuse. | **~1–2 weeks + ongoing** | "What has the group learned about X across all projects" (community reports); the graph **stops rotting** (lint); retrieval ranks by usefulness, not just cosine. |

**Recommended commitment:** fund **P0–P2 now** (~3 focused weeks for a solid v1); treat **P3 as fast-follow**, and start it early only if the dedup review queue (P1) grows faster than admins can clear it. P3's Leiden step needs a graph algorithm the runner (not Postgres) executes — fine, since the runner already has compute; don't attempt it in an Edge Function.

---

## 8. Risks & alternatives considered

**What NOT to build (and why):**
- **A separate graph DB (Neo4j / Apache AGE / FalkorDB).** AGE isn't available on Supabase managed and the workaround is a second database ([#40285](https://github.com/orgs/supabase/discussions/40285)); Zep/Graphiti *only* support Neo4j/FalkorDB/Kuzu — no Postgres backend, [issue #779 open](https://github.com/getzep/graphiti/issues/779). Any of these forfeits RLS unification, PostgREST auto-API, and one-database simplicity. Recursive CTEs + `ltree` fully cover 2–3-hop traversal at Publify's tens-of-thousands-of-nodes scale; that's all a knowledge map needs.
- **Adopting a Python memory framework wholesale (mem0 / Letta / Cognee / LlamaIndex).** All are Python services/libraries — each means running a *second backend* (Railway/VPS), contradicting the no-build, Supabase-only, static-frontend architecture. mem0 additionally has active Supabase migration bugs; its graph half wants Neo4j. **Borrow their ideas, not their runtimes** — which this design does (mem0's ADD/UPDATE/NOOP ops in §4.4, Graphiti's bitemporal edges in §3.1, Zep's episodic→semantic→community tiers as step→finding→community, Cognee's memify weight in P3).
- **Flat markdown files (the literal gist).** No concurrency, no RLS, no aggregate queries ("all findings using dataset X across all projects") — the exact capabilities Publify's multi-tenant goal requires. Keep the gist's *behaviors*, not its files.
- **Over-investing in the graph viz** or shipping a 3D graph. Search + wiki pages do the daily retrieval; the graph is for discovery. Ship the cheap Search tab (P0) before the expensive Map tab (P2).

**Live risks and mitigations:**
- **Embedding-dimension lock-in.** You cannot mix 384/1536-dim vectors in one HNSW column. *Mitigation:* pick 1536 (OpenAI 3-small) up front given Hungarian content; store `model`+`dim` so a future re-embed is a clean, additive migration (new column + new index).
- **Hungarian text.** FTS uses `to_tsvector('simple', …)` in the DDL (safe for mixed HU/EN technical text; no wrong-language stemming). If content proves HU-dominant, switch to `'hungarian'` (Postgres ships the snowball config) — a one-line change. Embeddings already default to the multilingual OpenAI model for this reason.
- **LLM extraction quality/cost.** *Mitigation:* big-model-to-extract / cheap-model-to-summarize split; incremental **union** updates (never full rebuild) bound per-step cost; gleaning capped at 1–2 rounds.
- **False merges in entity resolution.** *Mitigation:* conservative auto-merge threshold (≥0.92 + type match), a mid-band admin review queue, and full alias/lineage retention so any merge is reversible and explainable.
- **Vector leakage via RLS.** *Mitigation:* `km_embeddings` read policy mirrors node visibility through the denormalized columns; cross-project `similar_to` edges only materialize between mutually-readable nodes.
- **Graph rot.** *Mitigation:* the P3 lint job — the piece home-grown knowledge graphs skip and the reason they die.
- **DDL only via SQL Editor.** *Mitigation:* keep every change as a numbered migration file (`migration-34-…`), copy-pasted into the Editor — same workflow migrations 31/32/33 already use.

**Cost:** ~**$0 incremental** compute (runs in existing Supabase Postgres). Embeddings ~**cents** for a full backfill on OpenAI 3-small (or $0 on gte-small). HNSW memory at tens of thousands of nodes is tens of MB — budget a **Pro instance (~$25/mo)** for headroom if not already on one. The dominant cost is **engineering** (~3 focused weeks for P0–P2), concentrated in P1's extraction quality and P2's map UI — exactly where it should be.

---

### Key sources
Karpathy LLM-Wiki gist — https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f · Supabase pgvector — https://supabase.com/docs/guides/database/extensions/pgvector · HNSW — https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes · Hybrid search (RRF) — https://supabase.com/docs/guides/ai/hybrid-search · Automatic embeddings — https://supabase.com/docs/guides/ai/automatic-embeddings · Edge-function inference (gte-small) — https://supabase.com/blog/ai-inference-now-available-in-supabase-edge-functions · Apache AGE not on Supabase — https://github.com/orgs/supabase/discussions/40285 · Graphiti no-Postgres (issue #779) — https://github.com/getzep/graphiti/issues/779 · Zep bitemporal graph (arXiv:2501.13956) — https://arxiv.org/abs/2501.13956 · GraphRAG (Local→Global) — https://arxiv.org/pdf/2404.16130 · LightRAG — https://arxiv.org/abs/2410.05779 · force-graph — https://github.com/vasturiano/force-graph · Cytoscape.js — https://bundlephobia.com/package/cytoscape
