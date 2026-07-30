# Publify — DB baseline & fresh-instance runbook

**What this is.** A consolidated snapshot of the Publify Postgres schema (the end-state of
`backend/migration-001 … migration-100`), so a **fresh / staging / test Supabase project** can be
stood up in one pass instead of hand-applying 100 migrations in order.

**Snapshot point:** state as of **migration-100** (2026-07-29), generated with `supabase db dump`.
- `00_extensions.sql` — required Postgres extensions (run first).
- `01_schema.sql` — tables, RLS policies, functions, indexes, RLS-enable (the `pg_dump` output; 106 tables · 230 policies · 78 functions · 121 indexes).
- `02_triggers.sql` — the **trigger bindings** (`CREATE TRIGGER …`). ⚠️ `supabase db dump --schema public` omits these, so they were extracted faithfully from the migration files. Includes the security guards (`rp_guard_owner`, `guard_profile_update`, …) and `on_auth_user_created` on `auth.users` (auto-creates a profile on sign-up).

---

## Stand up a fresh instance

1. **Create the Supabase project** (or `supabase start` for local). Note the project ref.
2. **Roles & auth:** the `authenticated`, `anon`, `service_role` roles and the `auth` schema exist by default on any Supabase project — nothing to do.
3. **Apply, in order** (SQL editor, or `psql`):
   ```
   00_extensions.sql   →   01_schema.sql   →   02_triggers.sql
   ```
   In the SQL editor: paste each file's contents and run, in that order. (`01_schema.sql` is large — run it as one statement batch.)
4. **Storage buckets** are NOT in the SQL dump. Recreate the app's buckets used by the code:
   `research-data` (research files/uploads/canvas media), `dm-files` (DM attachments), plus any
   others referenced in the client (`sb.storage.from(...)`). Create them in Dashboard → Storage,
   then apply their RLS (see the `migration-*` files that set storage policies).
5. **Edge functions:** `supabase functions deploy <name> --project-ref <ref>` for each function under
   `supabase/functions/` (they carry their own `_shared` deps). Set the secrets they need
   (`ANTHROPIC_API_KEY`, `OPENALEX_API_KEY`, `ELICIT_API_KEY`, …) with `supabase secrets set`.
6. **Seed (optional):** `backend/seed-*.mjs` for demo data / researcher accounts.

## Going forward (new migrations)

- Keep authoring incremental migrations as `backend/migration-101…N.sql` (the established manual-apply
  flow on the live DB is unchanged).
- **Re-baseline** after a batch of migrations: re-run `supabase db dump` (Docker running) to refresh
  `01_schema.sql`, re-extract triggers into `02_triggers.sql`, and bump the snapshot point above.
  Command used:
  ```
  export SUPABASE_DB_PASSWORD="$(cat ~/.publify-db-password)"
  supabase db dump --linked --schema public -f backend/baseline/01_schema.sql
  ```

## Notes / caveats

- **Triggers gap:** always regenerate `02_triggers.sql` when re-baselining — the dump will keep omitting
  `CREATE TRIGGER`. (Extraction: grep the full `create trigger … ;` statements from `backend/migration-*.sql`, last-wins per name, each preceded by a `drop trigger if exists`.)
- **Extensions:** if `pg_cron`/`pg_net` fail via `CREATE EXTENSION` on a given plan, enable them in
  Dashboard → Database → Extensions, then re-run `00_extensions.sql`.
- **Secrets are never in this baseline** — no DB password, no API keys. The DB password used for the dump
  lives only in `~/.publify-db-password` (git-ignored, outside the repo); rotate it if it was ever shared.
