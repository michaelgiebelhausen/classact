-- ClassAct — 0042: given and family name, held separately.
--
-- Onboarding and the profile editor used to capture a single `full_name`, so a
-- person who wanted to fix just their surname — or who has a multi-word given
-- name that no split heuristic can recover from the combined string — had no
-- clean way to edit the two parts independently.
--
-- These two columns are the source the person edits. `full_name` stays the
-- canonical value the rest of the app reads and displays; the app composes it
-- as "first last" whenever these are saved, so nothing downstream changes.
--
-- Both nullable, no backfill: existing rows keep only `full_name` until their
-- owner next edits, and the editor pre-fills the two fields by splitting
-- `full_name` in the meantime. The first save stores the authoritative split.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

comment on column public.profiles.first_name is
  'Given name(s), edited separately from the surname. full_name is composed from first_name + last_name on save; null until the row is next edited.';

comment on column public.profiles.last_name is
  'Family name, edited separately from the given name. full_name is composed from first_name + last_name on save; null until the row is next edited.';
