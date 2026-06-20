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
