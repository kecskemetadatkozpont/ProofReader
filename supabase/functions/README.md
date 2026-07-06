# Publify Edge Functions (Supabase / Deno)

Server-side functions where secret API keys live (never in the browser). This is the **platform-key**
model: one key per provider, set as an Edge secret, called from the app via `supabase.functions.invoke`.

## research-ai (R1 — research idea / gap analysis via Claude)

Reads a project + its literature library under the caller's JWT (RLS applies), asks Claude for
candidate research questions, and inserts them as `research_ideas` (source = `gap`).

### One-time setup
```bash
# from the repo root (needs the Supabase CLI + `supabase login`, project ref jokqthwszkweyqmmdesn)
supabase link --project-ref jokqthwszkweyqmmdesn

# set the platform key (and optionally the model — default claude-sonnet-4-6)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# supabase secrets set RESEARCH_AI_MODEL=claude-opus-4-8

# deploy
supabase functions deploy research-ai --project-ref jokqthwszkweyqmmdesn
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are injected automatically — no need to set them.

### In the app
The Research workspace → a project → **Ideas** tab → **✨ Gap analysis (AI)**. Until the function is
deployed the button shows "AI not configured"; everything else (own ideas, OpenAlex literature search)
works without it.

### Cost / quota (platform-key model)
The key is shared, so add per-user/project quotas before opening this widely. A later migration will add
an `ai_usage` table + a budget check at the top of the function (R7 — cost dashboards).

## research-chat (R5b — Ideas chat with Consensus via MCP)

A Claude session in the Ideas tab that talks to **Consensus** through the Anthropic **MCP connector**
(remote MCP server `https://mcp.consensus.app/mcp`). Loads the chat history under the caller's JWT (RLS),
runs one Claude turn with the Consensus MCP attached, then persists the assistant message + raw
tool-use/tool-result blocks + best-effort evidence into `research_messages` / `research_evidence` — so
the app owns and can reuse everything discussed.

### Setup
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set CONSENSUS_MCP_TOKEN=<bearer token from consensus.app>   # the Consensus API key, used as the MCP bearer
# optional: supabase secrets set CONSENSUS_MCP_URL=https://mcp.consensus.app/mcp   RESEARCH_AI_MODEL=claude-opus-4-8
supabase functions deploy research-chat --project-ref jokqthwszkweyqmmdesn
```
Prereq: run `backend/migration-16-research-chat.sql` first. Until the function is deployed + the secrets
are set, the chat persists the user's messages and shows "Consensus connection pending".

**Consensus is optional** — with only `ANTHROPIC_API_KEY` set, the chat works as a plain Claude chat;
add `CONSENSUS_MCP_TOKEN` and it auto-upgrades to evidence-grounded Consensus mode (no redeploy needed).

### Cost control (shared by research-chat + research-ai)
| secret | effect | cheap-test value |
|---|---|---|
| `RESEARCH_AI_MODEL` | which model | `claude-haiku-4-5-20251001` (cheapest) |
| `RESEARCH_MAX_TOKENS` | output cap per reply | `800` (chat) / lower = cheaper |
| `RESEARCH_HISTORY` | last N messages sent (input cap) | `12` |

**The hard ceiling lives in the Anthropic Console**, not the code: load a small **prepaid** balance
(e.g. $5) with **auto-reload OFF** → the API stops when it runs out. That guarantees "a few dollars max".
The function returns `usage` (input/output tokens) per call for monitoring.

---

## Memory Layer — km-distill + km-search (Memory.html / tudástérkép)

Builds a knowledge graph automatically from completed protocol tasks. Stays on the **Claude + Supabase**
line: Claude API for entity/relation extraction, the **built-in `gte-small`** model for embeddings
(384-dim, no external embedding API).

**Prereq:** apply `backend/migration-45-memory-layer.sql` in the SQL Editor first (km_* tables, RLS,
`km_hybrid_search` / `km_subgraph` RPCs, the `km_ingested_at` marker + re-ingest trigger).

```bash
# reuses the same ANTHROPIC_API_KEY as research-chat
supabase secrets set KM_CRON_SECRET=$(openssl rand -hex 24)   # lets pg_cron / manual cron invoke km-distill
# optional: supabase secrets set KM_MODEL=claude-sonnet-4-6   KM_BATCH=8
supabase functions deploy km-distill --project-ref jokqthwszkweyqmmdesn
supabase functions deploy km-search  --project-ref jokqthwszkweyqmmdesn
```

- **km-distill** — the ingester. Drains `research_protocol_steps` where `status='done'` and
  `km_ingested_at is null`: deterministic nodes/edges from `spec`/`result` columns + Claude extraction
  from the free-text report, then embeds each node with `gte-small`. Runs as **service role** but stamps
  each node's `project_id`/`created_by` from the source step (isolation preserved). Trigger it from the
  Memory page **⟳ Sync** button (admin JWT) or on a schedule (`x-km-secret: $KM_CRON_SECRET`).
  Optional pg_cron:
  ```sql
  select cron.schedule('km-distill-15m', '*/15 * * * *', $$
    select net.http_post(
      url    := 'https://jokqthwszkweyqmmdesn.functions.supabase.co/km-distill',
      headers:= jsonb_build_object('content-type','application/json','x-km-secret','<KM_CRON_SECRET>'),
      body   := jsonb_build_object('limit', 12)) $$);
  ```
- **km-search** — semantic search. Embeds the query with `gte-small`, calls `km_hybrid_search`
  (RRF of full-text + vector) **under the caller's JWT** so RLS composes. The Memory page works with
  full-text only until this is deployed; deploying it adds the ✨ Semantic ranking.

**Cost:** the deterministic pass is free; extraction is one short Claude call per completed task; embeddings
are free (`gte-small` runs inside the Edge runtime). The same prepaid-balance ceiling applies.
