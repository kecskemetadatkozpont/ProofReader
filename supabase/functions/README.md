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
