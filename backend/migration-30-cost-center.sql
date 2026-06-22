-- migration-30: John von Neumann University cost center (Költséghely), required at onboarding for JNU users.
alter table public.profiles add column if not exists cost_center_code text;
alter table public.profiles add column if not exists cost_center      text;
comment on column public.profiles.cost_center_code is 'JNU Ktg.hely code (e.g. KPSZRHDI01); set when affiliation is John von Neumann University.';
comment on column public.profiles.cost_center      is 'JNU cost center name (Szervezeti egység megnevezése).';
