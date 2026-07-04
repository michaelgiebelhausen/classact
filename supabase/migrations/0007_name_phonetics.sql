-- 0007_name_phonetics.sql
-- A phonetic pronunciation guide for a person's name ("shiv-AWN"), entered once
-- at onboarding and surfaced under the name in the name games. Mirrors the
-- nickname_phonetic field from the old ClassroomDJ system — a mispronounced name
-- is the same "I don't really know you" failure the games exist to fix.
--
-- Person-level attribute → lives on profiles (entered once, applies everywhere).
-- The existing "update own profile" policy already covers writes to this column;
-- the games page reads it through the admin client.

alter table public.profiles
  add column if not exists name_phonetic text;
