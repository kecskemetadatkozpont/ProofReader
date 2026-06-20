-- ============================================================================
--  Publify — migration 17: chat message attachments (R5b C-attach).
--  A user message can carry attachments: project library sources, the user's own
--  publication files, or freshly uploaded files. Stored as a jsonb array on the
--  message; the research-chat Edge Function expands them into Claude content blocks
--  (PDF → document block, source/text → text block). Run in the SQL editor.
-- ============================================================================

alter table research_messages add column if not exists attachments jsonb;

-- shape (array of):
--   { "kind":"source", "source_id":"<uuid>", "title":"…" }              -- project library item (Edge fetches abstract)
--   { "kind":"file", "bucket":"publication-files", "path":"…", "name":"…", "mime":"application/pdf" }
--   { "kind":"file", "bucket":"research-data",     "path":"<project_id>/…", "name":"…", "mime":"text/csv" }
