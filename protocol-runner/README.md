# Protocol runner — dedicated machine

This runs the **Protocol** you build in Publify (Research → Protocol tab). It claims a protocol you marked
**Ready**, then executes its steps with **Claude Code**, in dependency order, pausing on the steps you marked
*needs approval* until you approve them in the app. Progress + results stream back to the Protocol tab live.

```
Publify (control plane)            this machine (execution plane)
─────────────────────              ────────────────────────────
Generate + edit protocol           runner polls Supabase
Set "Runner ID" + repo             claims a 'ready' protocol for its RUNNER_ID
Mark Ready  ───────────────────▶   runs each step with `claude -p …` in REPO_DIR
Approve needs-approval steps  ◀──  pauses needs-approval steps (status 'blocked')
Watch live progress           ◀──  writes status / metrics / artifacts back
```

## Setup (once)

1. **Install Node 18+** and the **Claude Code CLI**, and log in:
   ```sh
   npm i -g @anthropic-ai/claude-code   # or your usual install
   claude            # log in once, accept the workspace
   ```
2. **Get your project repo** on this machine (the steps run with this as the working dir).
3. **Get the Supabase service-role key** (Publify → Supabase dashboard → Project Settings → API → `service_role`).
   Keep it on THIS machine only — it bypasses row-level security.

## Run

```sh
export SUPABASE_URL="https://jokqthwszkweyqmmdesn.supabase.co"
export SUPABASE_SERVICE_KEY="<service-role key>"
export RUNNER_ID="gpu-box"          # must match the "Runner ID" you set on the protocol in Publify
export REPO_DIR="$HOME/research/fisher-fusion"   # your project repo
node protocol-runner.mjs
```

Leave it running. It polls every 10s. When you mark a protocol **Ready** (with this `RUNNER_ID`) it claims it and
starts. Steps marked *needs approval* stop as **Needs approval** in the app — click **✓ Approve to run** there and
the runner picks them up.

## How a step is executed

For each step the runner calls `claude -p "<title + instruction + inputs/outputs + acceptance + command hint>"`
(`--permission-mode acceptEdits`) in `REPO_DIR`. Claude does the work, verifies the acceptance criteria, and prints
a final JSON line `{"ok":…,"metrics":…,"artifacts":…,"note":…}` which the runner stores on the step. A failing step
marks the protocol `failed`; you can fix the step's spec in the app and re-run.

## Safety

- The runner only touches protocols whose `runner_id` equals your `RUNNER_ID`.
- Expensive / destructive steps should be marked **needs approval** (the generator does this by default) so the
  runner waits for your explicit OK before running them.
- `--permission-mode acceptEdits` lets Claude edit files + run commands in the repo. Run on a machine/repo you
  control. For tighter control, lower the permission mode or run inside a container.
- Never commit the service-role key.
