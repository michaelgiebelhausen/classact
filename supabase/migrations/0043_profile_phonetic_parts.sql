-- ClassAct — 0043: pronunciation held per name part.
--
-- 0042 split the name into first_name / last_name so they edit separately.
-- The pronunciation stayed a single `name_phonetic`, so you could say how your
-- whole name sounds but not fix just the surname. These two columns are the
-- part-wise source the person edits; `name_phonetic` stays the canonical value
-- the name games and cards read, composed as "first last" on save — exactly
-- how full_name is composed from the two name parts.
--
-- Both nullable, no backfill: existing rows keep only `name_phonetic` until
-- their owner next edits, and the editor pre-fills the two fields by splitting
-- `name_phonetic` in the meantime. The first save stores the authoritative
-- split.

alter table public.profiles
  add column if not exists first_name_phonetic text,
  add column if not exists last_name_phonetic text;

comment on column public.profiles.first_name_phonetic is
  'How the given name is said, edited separately. name_phonetic is composed from first_name_phonetic + last_name_phonetic on save; null until the row is next edited.';

comment on column public.profiles.last_name_phonetic is
  'How the family name is said, edited separately. name_phonetic is composed from first_name_phonetic + last_name_phonetic on save; null until the row is next edited.';
