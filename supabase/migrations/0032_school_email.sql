-- ClassAct — 0032: a student's official school address, held separately from
-- their login.
--
-- Canvas is the roster of record and reports one address per student. Students
-- sign in with whatever they like — a personal Gmail, an iCloud account, the
-- g.-twin of their university address. Until now the only way to be "confirmed
-- from Canvas" was for those two to be the same string (or g.-twins of each
-- other), which leaves a student who prefers their own email permanently
-- filed as unmatched however obviously they are on the roster.
--
-- Separating the two fixes that: `school_email` is an attribute of the person,
-- not their credential. They keep signing in as tpallotta17@gmail.com and are
-- still recognised as tpallot@clemson.edu on the Canvas roster.
--
-- `school_email_verified_at` exists from the start and is deliberately not
-- enforced yet. These are one professor's own students and matches are being
-- made by hand, so ownership is established by a human who knows them rather
-- than by a round trip through email. When that stops being true, requiring a
-- non-null value here is the whole change — no migration, no backfill.
--
-- Unverified claims are visible rather than silent: a professor can see who
-- asserted what, which is the honest version of trusting people.

alter table public.profiles
  add column if not exists school_email text,
  add column if not exists school_email_verified_at timestamptz;

comment on column public.profiles.school_email is
  'Official institutional address as it appears on the Canvas roster, which may differ from the address this account signs in with.';

comment on column public.profiles.school_email_verified_at is
  'When ownership of school_email was established. Null means claimed but unproven — currently allowed, since matches are made by a professor who knows the student.';

-- One school address cannot belong to two people: that is the whole identity
-- claim, and duplicating it would hand one student another''s roster place.
create unique index if not exists idx_profiles_school_email
  on public.profiles (lower(school_email))
  where school_email is not null;
