# ProofReader

LaTeX read-aloud editor with a Supabase backend (Google sign-in + cloud-synced projects).

## Live URLs (after GitHub Pages is enabled)

- Dashboard: `https://<user>.github.io/proofreader/` (redirects to Projects.html)
- Editor:    `https://<user>.github.io/proofreader/ProofReader.html`

## One-time setup

1. **Push these files** to a **public** GitHub repo named `proofreader` (keep the
   folder structure — the `backend/` and `assets/` subfolders must come along).
2. **Enable Pages:** repo → Settings → Pages → Source = "Deploy from a branch",
   Branch = `main` / root → Save. Wait ~1 minute for the URL to go live.
3. **Allow the URL in Supabase:** Authentication → URL Configuration
   - Site URL: `https://<user>.github.io/proofreader/`
   - Redirect URLs → add: `https://<user>.github.io/proofreader/**`
   - Save.
4. Open the editor URL → **Continue with Google** → sign in. Create a project,
   reload — it persists from the cloud.

## Notes

- `backend/config.js` holds the Supabase URL and the **publishable (anon) key**.
  These are public by design; row-level security protects the data. No secret
  keys are in this repo.
- Without a Supabase session the app runs in **demo mode** (local-only), so it
  never breaks.
- Database setup lives in the project's `backend/schema.sql` and
  `backend/migration-01.sql` (run once in the Supabase SQL Editor).

## Updating later

Replace the changed file(s) in the repo (GitHub web UI → Add file → Upload
files, or `git push`). GitHub Pages rebuilds automatically in ~30 seconds.
No Supabase changes needed.
