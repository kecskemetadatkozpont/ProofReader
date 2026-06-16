# ElevenLabs narration cache & credit metering

Aloud never re-charges for audio it has already generated. Each sentence's MP3 is
content-addressed by a hash of `(text, voice, model, stability, similarity)` and
looked up in three layers before any ElevenLabs call is made:

1. **In-memory** — instant within a session.
2. **IndexedDB** (`pr_tts` DB, this browser) — survives reloads. Works out of the box,
   no setup. Re-listening is free.
3. **Supabase Storage** (`tts-cache` bucket) — **shared across users**. When a project
   is shared, a collaborator playing the same sentence with the same voice/model reuses
   the stored audio instead of paying for it. Requires the one-time setup below.

Only a true miss at all three layers triggers synthesis, and only that is billed and
counted. The per-thesis charge is shown in the editor's **KPIs** panel ("Narration cost":
credits, characters, syntheses); the model defaults to **Eleven v3**.

## One-time Supabase setup (enables the shared cloud cache)

Without this, everything still works — the cloud layer disables itself for the session
and playback falls back to IndexedDB + direct synthesis. To enable cross-user reuse:

1. **Create the bucket** — Supabase dashboard → Storage → New bucket → name `tts-cache`,
   keep it **private**. (Or run the SQL below.)
2. **Add access policies** so signed-in users can read and write cached audio. In the
   SQL editor:

```sql
-- bucket (skip if you created it in the dashboard)
insert into storage.buckets (id, name, public)
values ('tts-cache', 'tts-cache', false)
on conflict (id) do nothing;

-- authenticated users may read cached objects and add new ones (no UPDATE needed —
-- objects are immutable & content-addressed, so writes are first-writer-wins)
create policy "tts cache read"   on storage.objects for select to authenticated using (bucket_id = 'tts-cache');
create policy "tts cache insert" on storage.objects for insert to authenticated with check (bucket_id = 'tts-cache');
```

### Privacy & integrity
- Objects are named by a **SHA-256** of `(text, voice, model, settings)`, so keys are not
  enumerable: a user can only reach audio whose exact source text they already hold (i.e.
  a project they were granted access to).
- Writes use `upsert:false` (first-writer-wins). Because the content is immutable for a
  given key, an existing cached object is never overwritten — so a malicious upload can't
  poison the cache, and no UPDATE policy is granted.
- If you want hard per-project isolation regardless of the above, store objects under a
  `projectId/` path prefix and scope the read policy to project membership.

## Notes
- The key stays in the browser; calls go directly to ElevenLabs (per-browser, per-user).
- Credits are estimated as characters × model multiplier (Flash/Turbo are 0.5×); the
  exact charge is the character count, shown alongside. The voice panel also shows the
  real account-level usage from `/v1/user/subscription`.
