-- ClassAct — 0020: LinkedIn on the profile.
-- The whole product argues a classroom is a professional network in
-- disguise; this is the handle that makes the connection outlast the term.
-- Opt-in and self-entered; coursemates see it through the existing profile
-- reads, so RLS on profiles is unchanged.

alter table public.profiles
  add column if not exists linkedin_url text;
