-- Saved audiobooks: generated ElevenLabs narrations persist (DB row + the concatenated MP3 in Storage) so they
-- never need regenerating. owner-only RLS; project_id links a study-sourced audiobook to its research project.
create table if not exists public.audiobooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.research_projects(id) on delete set null,
  title text not null,
  source_kind text not null default 'text',      -- study | upload | text
  source_ref text,                               -- study_id / filename / etc.
  language text,                                 -- target language label
  translated boolean not null default false,
  voice_id text, voice_name text, model text,
  settings jsonb not null default '{}'::jsonb,   -- {rate, stability, similarity}
  segments jsonb not null default '[]'::jsonb,   -- [{text, start, dur, kind}]
  audio_path text,                               -- Storage path of the concatenated MP3
  chars int, duration_sec int,
  status text not null default 'ready',          -- generating | ready | error
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ab_owner_idx on public.audiobooks(owner_id);
alter table public.audiobooks enable row level security;
drop policy if exists ab_rw on public.audiobooks;
create policy ab_rw on public.audiobooks for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- private Storage bucket for the final MP3s; each user can only touch files under their own uid/ prefix
insert into storage.buckets (id, name, public) values ('audiobooks', 'audiobooks', false) on conflict (id) do nothing;
drop policy if exists ab_obj_rw on storage.objects;
create policy ab_obj_rw on storage.objects for all to authenticated
  using (bucket_id = 'audiobooks' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'audiobooks' and (storage.foldername(name))[1] = auth.uid()::text);
