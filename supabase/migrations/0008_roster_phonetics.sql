-- 0008_roster_phonetics.sql
-- An auto-generated pronunciation guide attached to the roster row when a
-- student is added (CSV import or Canvas sync). Because it's derived from the
-- roster name — before the student has a profile — it lives on the enrollment,
-- not on profiles. It's only a DEFAULT: the name games and onboarding fall back
-- to it, but a student's own profiles.name_phonetic (0007) always wins, and the
-- onboarding field is pre-filled with it so the student can confirm or fix it.

alter table public.enrollments
  add column if not exists roster_name_phonetic text;
