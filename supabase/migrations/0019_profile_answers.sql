-- ClassAct — 0019: profile-level icebreaker answers.
-- Students answer icebreakers per course, keyed to their enrollment. The
-- professor has no enrollment in their own course, so their answers hang
-- off the profile instead — one set, reused across every course they teach.
-- The name games read these through the service role, so an own-row policy
-- is all that's needed here.

create table if not exists public.profile_answers (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  field_key text not null,          -- an ICEBREAKER_CATALOG key, e.g. 'hometown'
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, field_key)
);

alter table public.profile_answers enable row level security;

create policy profile_answers_own on public.profile_answers for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
