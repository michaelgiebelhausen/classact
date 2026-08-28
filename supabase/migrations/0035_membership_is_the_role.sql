-- ClassAct — 0035: stop letting sign-up decide who is a professor.
--
-- 0023 taught handle_new_user() to read `role` out of the sign-up form's user
-- metadata. The form defaulted that toggle to "A professor", so every student
-- who typed an email and a password and pressed the only button on the screen
-- was written into public.profiles as a professor. That is the whole of the
-- "students somehow made themselves professors" mystery: nobody chose it, the
-- answer was pre-filled.
--
-- The role is now derived per course, not declared per account:
--   professor of a course  <=>  courses.professor_id = you
--   student of a course    <=>  a non-dropped row in enrollments
-- which lets one person be both, in different courses — something a single
-- column on profiles could never say. See src/lib/membership.ts.
--
-- So this trigger stops reading metadata entirely. Sign-up no longer sends a
-- role, and even if a stale client did, it is ignored: the value is not an
-- input any more.
--
-- profiles.role is left in place, and left alone. Nothing in the application
-- reads it as of this migration, so its stored values (including every wrong
-- one) are inert. Dropping the column is a separate, later migration, once a
-- semester has passed without anything reaching for it — a live class is the
-- wrong place to find out about a reference we missed.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on column public.profiles.role is
  'INERT as of 0035. Roles are derived per course (courses.professor_id / '
  'enrollments), never declared on the account. Nothing reads this; do not '
  'add anything that does. Slated for removal.';
