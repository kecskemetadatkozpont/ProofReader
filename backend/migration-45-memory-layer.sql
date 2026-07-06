-- ============================================================================
--  Publify — migration 45: Memory Layer (knowledge graph / tudástérkép).
--
--  A Postgres-native knowledge graph built INSIDE the existing Supabase DB from
--  the work done on the platform. It is fed by the `km-distill` edge function,
--  which distills every completed research_protocol_steps.result into typed
--  nodes/edges (deterministic edges from columns + Claude extraction from free
--  text) and embeds each node with the built-in `gte-small` model (384-dim).
--  Retrieval: hybrid FTS + vector (RRF) via km_hybrid_search; graph reads go
--  straight through RLS-scoped km_nodes / km_edges. Everything stays on the
--  Claude + Supabase line — no external embedding API.
--
--  RLS reuses research_can_read_project / research_can_write_project (migr-11),
--  so a node is visible to exactly whoever can see its source project (owner,
--  the linked supervisor, admin). The distill runner writes via service-role
--  (bypasses RLS) but STAMPS project_id/created_by from the source step.
--
--  P0 scope: nodes are project-scoped (no cross-project entity merge yet — the
--  same concept in two projects is two nodes, grouped softly in the UI by
--  norm_title). Cross-project canonical nodes + a lint pass are P1+.
--
--  Apply in the Supabase SQL Editor (the sb_secret_ key cannot run DDL over the
--  wire). Idempotent — safe to re-run.
-- ============================================================================

create extension if not exists vector with schema extensions;   -- pgvector (installs into the extensions schema)
create extension if not exists ltree;                           -- containment paths (project.protocol.step)

-- ---------------------------------------------------------------------------
-- 0. Ontology — the closed vocabulary. Editable, so the schema can grow.
-- ---------------------------------------------------------------------------
create table if not exists km_ontology (
  id          smallint generated always as identity primary key,
  kind        text not null check (kind in ('node', 'edge')),
  name        text not null,
  description text,
  unique (kind, name)
);
insert into km_ontology (kind, name, description) values
  ('node', 'result',     'The outcome of one completed protocol step (summary/report).'),
  ('node', 'finding',    'A claim or conclusion drawn from a result.'),
  ('node', 'method',     'A technique / model / algorithm used.'),
  ('node', 'dataset',    'A dataset or data source.'),
  ('node', 'metric',     'A measured quantity (value stored in props.value).'),
  ('node', 'artifact',   'A produced file / figure / table.'),
  ('node', 'tool',       'A tool / library / command.'),
  ('node', 'hypothesis', 'A hypothesis or research question.'),
  ('node', 'paper',      'A cited paper / reference.'),
  ('node', 'entity',     'Any other named concept.'),
  ('edge', 'uses',        'source uses target (result/method uses a dataset/tool).'),
  ('edge', 'produces',    'source produces target (result produces a metric/artifact).'),
  ('edge', 'measures',    'source measures target.'),
  ('edge', 'supports',    'source supports target (finding supports hypothesis).'),
  ('edge', 'contradicts', 'source contradicts target (later result reverses an earlier one).'),
  ('edge', 'derived_from','source derived from target.'),
  ('edge', 'evaluates',   'source evaluates target.'),
  ('edge', 'cites',       'source cites target (paper).'),
  ('edge', 'related_to',  'generic association.')
on conflict (kind, name) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Nodes — the graph vertices / "wiki pages".
--    norm_title = lower/trimmed/space-collapsed title; (project_id,kind,norm_title)
--    is the within-project dedup key so re-ingest UPSERTs instead of duplicating.
-- ---------------------------------------------------------------------------
create table if not exists km_nodes (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  title       text not null,
  norm_title  text not null,
  body        text,                                   -- distilled markdown (the "page body")
  project_id  uuid not null references research_projects(id) on delete cascade,
  protocol_id uuid references research_protocols(id) on delete set null,
  step_id     uuid references research_protocol_steps(id) on delete set null,   -- linkback to the task
  source_kind text,                                   -- which field it came from (result.summary, spec.inputs, llm, …)
  props       jsonb not null default '{}'::jsonb,     -- {value, unit, url, tags[], …}
  created_by  uuid references profiles(id) on delete set null,
  fts         tsvector generated always as
                (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists km_nodes_dedup   on km_nodes (project_id, kind, norm_title);
create index        if not exists km_nodes_fts     on km_nodes using gin (fts);
create index        if not exists km_nodes_project on km_nodes (project_id);
create index        if not exists km_nodes_kind    on km_nodes (kind);
create index        if not exists km_nodes_step    on km_nodes (step_id);
create index        if not exists km_nodes_normttl on km_nodes (norm_title);   -- soft cross-project grouping

-- ---------------------------------------------------------------------------
-- 2. Edges — typed, directed. project_id denormalized so RLS is a direct call.
-- ---------------------------------------------------------------------------
create table if not exists km_edges (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references km_nodes(id) on delete cascade,
  target_id   uuid not null references km_nodes(id) on delete cascade,
  rel         text not null,
  weight      real not null default 1.0,
  evidence    text,                                   -- source sentence / justification
  project_id  uuid not null references research_projects(id) on delete cascade,
  step_id     uuid references research_protocol_steps(id) on delete set null,
  created_by  uuid references profiles(id) on delete set null,
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (source_id, target_id, rel)
);
create index if not exists km_edges_source  on km_edges (source_id);
create index if not exists km_edges_target  on km_edges (target_id);
create index if not exists km_edges_project on km_edges (project_id);
create index if not exists km_edges_rel     on km_edges (rel);

-- ---------------------------------------------------------------------------
-- 3. Embeddings — one gte-small (384-dim) vector per node. project_id
--    denormalized so the vector table's RLS never joins back to km_nodes.
-- ---------------------------------------------------------------------------
create table if not exists km_embeddings (
  node_id    uuid primary key references km_nodes(id) on delete cascade,
  model      text not null default 'gte-small',
  dim        int  not null default 384,
  embedding  extensions.vector(384),
  project_id uuid not null references research_projects(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- HNSW builds on an empty table and tolerates continuous inserts (unlike IVFFlat).
-- gte-small returns L2-normalized vectors, so inner product == cosine. Schema-qualify the type +
-- opclass so this resolves regardless of the session search_path (pgvector lives in `extensions`).
create index if not exists km_emb_hnsw on km_embeddings using hnsw (embedding extensions.vector_ip_ops);

-- ---------------------------------------------------------------------------
-- 4. Log — append-only provenance / recent-activity feed (karpathy's log.md).
-- ---------------------------------------------------------------------------
create table if not exists km_log (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  actor      uuid references profiles(id) on delete set null,   -- null = the runner / service role
  op         text not null,                                     -- ingest | search | merge | lint
  node_id    uuid references km_nodes(id) on delete set null,
  project_id uuid references research_projects(id) on delete cascade,
  note       text
);
create index if not exists km_log_ts      on km_log (ts desc);
create index if not exists km_log_project on km_log (project_id, ts desc);

-- ---------------------------------------------------------------------------
-- 5. Ingest marker on the source table + auto re-ingest on result change.
-- ---------------------------------------------------------------------------
alter table research_protocol_steps add column if not exists km_ingested_at timestamptz;
-- the distill worker drains this predicate:
create index if not exists rpst_km_todo on research_protocol_steps (finished_at)
  where status = 'done' and km_ingested_at is null;

-- editing a done step's result must re-ingest it → clear the marker when result changes.
-- (The worker's own UPDATE only touches km_ingested_at, so result is unchanged → no loop.)
create or replace function public.km_mark_dirty() returns trigger
language plpgsql as $$
begin
  if (new.result is distinct from old.result) then
    new.km_ingested_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists km_step_dirty on research_protocol_steps;
create trigger km_step_dirty before update on research_protocol_steps
  for each row execute function public.km_mark_dirty();

-- ---------------------------------------------------------------------------
-- 6. RLS — a km_* row is visible to whoever can read its source project.
--    Writes: editors of the project (admin/owner). The distill runner uses the
--    service role, which bypasses RLS, but stamps project_id/created_by itself.
-- ---------------------------------------------------------------------------
alter table km_nodes      enable row level security;
alter table km_edges      enable row level security;
alter table km_embeddings enable row level security;
alter table km_log        enable row level security;
alter table km_ontology   enable row level security;

drop policy if exists km_nodes_read  on km_nodes;
create policy km_nodes_read  on km_nodes  for select to authenticated using (research_can_read_project(project_id));
drop policy if exists km_nodes_write on km_nodes;
create policy km_nodes_write on km_nodes  for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

drop policy if exists km_edges_read  on km_edges;
create policy km_edges_read  on km_edges  for select to authenticated using (research_can_read_project(project_id));
drop policy if exists km_edges_write on km_edges;
create policy km_edges_write on km_edges  for all to authenticated
  using (research_can_write_project(project_id))
  with check (research_can_write_project(project_id)
    and exists (select 1 from km_nodes n where n.id = source_id and n.project_id = km_edges.project_id)
    and exists (select 1 from km_nodes n where n.id = target_id and n.project_id = km_edges.project_id));

-- embeddings mirror the node's visibility (via the denormalized project_id) — never
-- expose a vector of a node the caller can't read (semantic-search leakage guard). The write check
-- also pins the vector's project to its node's project, so an editor can't attach a vector to
-- someone else's node under their own project_id.
drop policy if exists km_emb_read  on km_embeddings;
create policy km_emb_read  on km_embeddings for select to authenticated using (research_can_read_project(project_id));
drop policy if exists km_emb_write on km_embeddings;
create policy km_emb_write on km_embeddings for all to authenticated
  using (research_can_write_project(project_id))
  with check (research_can_write_project(project_id)
    and exists (select 1 from km_nodes n where n.id = node_id and n.project_id = km_embeddings.project_id));

-- km-distill always stamps project_id, so log rows are always project-scoped → require project read.
drop policy if exists km_log_read on km_log;
create policy km_log_read on km_log for select to authenticated
  using (research_can_read_project(project_id));

drop policy if exists km_ont_read on km_ontology;
create policy km_ont_read on km_ontology for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 7. Retrieval RPCs. security invoker → RLS composes: a caller only ever fuses
--    rows they may read. Graph reads (nodes/edges) go direct through RLS.
-- ---------------------------------------------------------------------------

-- (a) Hybrid search: Reciprocal Rank Fusion of full-text + vector similarity.
-- search_path includes `extensions` so the pgvector type/operator resolve; each candidate CTE does its
-- ORDER BY + LIMIT in an INNER subquery so top-K is deterministic AND the HNSW index can accelerate it.
create or replace function public.km_hybrid_search(
  query_text      text,
  query_embedding extensions.vector(384) default null,
  match_count     int    default 24,
  fts_weight      real   default 1.0,
  vec_weight      real   default 1.0,
  rrf_k           int    default 50,
  filter_project  uuid   default null,
  filter_kinds    text[] default null
) returns setof km_nodes
language sql stable security invoker set search_path = public, extensions as $$
  with fts as (
    select id, row_number() over () as rank from (
      select n.id
      from km_nodes n
      where query_text is not null and query_text <> ''
        and n.fts @@ websearch_to_tsquery('simple', query_text)
        and (filter_project is null or n.project_id = filter_project)
        and (filter_kinds  is null or n.kind = any(filter_kinds))
      order by ts_rank_cd(n.fts, websearch_to_tsquery('simple', query_text)) desc
      limit match_count * 2
    ) f
  ),
  vec as (
    select id, row_number() over () as rank from (
      select e.node_id as id
      from km_embeddings e
      join km_nodes n on n.id = e.node_id
      where query_embedding is not null
        and (filter_project is null or e.project_id = filter_project)
        and (filter_kinds  is null or n.kind = any(filter_kinds))
      order by e.embedding <#> query_embedding
      limit match_count * 2
    ) v
  ),
  fused as (
    select coalesce(fts.id, vec.id) as id,
           coalesce(1.0 / (rrf_k + fts.rank), 0) * fts_weight
         + coalesce(1.0 / (rrf_k + vec.rank), 0) * vec_weight as score
    from fts full outer join vec on fts.id = vec.id
  )
  select n.*
  from km_nodes n
  join fused on fused.id = n.id
  order by fused.score desc
  limit match_count;
$$;

-- (b) Cycle-safe k-hop neighbourhood (node detail + the runner's reuse loop).
create or replace function public.km_subgraph(root uuid, max_hops int default 2)
returns table (id uuid, title text, kind text, depth int)
language sql stable security invoker set search_path = public, extensions as $$
  with recursive walk as (
    select n.id, n.title, n.kind, 0 as depth, array[n.id] as path
    from km_nodes n where n.id = root
    union all
    select n2.id, n2.title, n2.kind, w.depth + 1, w.path || n2.id
    from walk w
    join km_edges e on (e.source_id = w.id or e.target_id = w.id)
    join km_nodes n2 on n2.id = case when e.source_id = w.id then e.target_id else e.source_id end
    where w.depth < max_hops and not (n2.id = any(w.path))
  )
  select distinct id, title, kind, depth from walk order by depth;
$$;

grant execute on function public.km_hybrid_search(text, extensions.vector, int, real, real, int, uuid, text[]) to authenticated;
grant execute on function public.km_subgraph(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Done. Next: deploy the km-distill + km-search edge functions, then either
-- schedule km-distill (pg_cron) or press "Sync memory" in the Memory page.
-- ---------------------------------------------------------------------------
