-- migration-28: per-user gate for AI figure generation (PaperBanana integration). Costly, so admin-gated.
alter table public.profiles add column if not exists can_figures boolean not null default false;
comment on column public.profiles.can_figures is 'Admin-set: may the user generate paper figures (PaperBanana).';
