# Aloud — GitHub upload checklist

Upload everything in this `deploy` folder to your repo's **deploy/** folder
(GitHub → Add file → Upload files → drag all → Commit). Keep the `backend/`
and `assets/` subfolders.

## Run these in Supabase (SQL Editor) — once, in order
1. backend/schema.sql        (only if not already run)
2. backend/migration-01.sql  (adds projects.data column)
3. backend/migration-02.sql  (fixes new-user trigger)
4. backend/migration-03.sql  (registration + approval + admin)

## Supabase dashboard settings
- Storage → bucket **project-files** → set file size limit to **50 MB**.
- Authentication → URL Configuration → Site URL + Redirect (`…/**`) include your Pages URL.
- Google provider enabled.

## What's new in this release
- Landing.html              — marketing page (Aloud), feature demo, roadmap
- index.html                — now opens the Landing page
- onboarding.js             — registration form + pending-approval gate
- universities.js           — global university picker list
- Admin.html / admin.jsx    — admin dashboard (approvals, users, usage, storage)
- uploads.js                — large-file uploads (up to 50 MB) to Storage
- backend/migration-03.sql  — profiles role/status/affiliation + admin RLS
- backend.js, store-cloud.js, app.jsx, engine.js, workspace.jsx, editor-collab.jsx — updated

## Quick test
1. Open …/proofreader/ (Landing) → Get started → sign in with Google.
2. New (non-admin) account → onboarding → "pending" → approve it in Admin.
3. Admin account (kecskemet.adatkozpont@gmail.com) → floating "Admin" button.
4. Upload a >4 MB image into a project → appears under Storage → project-files.
