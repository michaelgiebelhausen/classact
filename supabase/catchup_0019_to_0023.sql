-- ClassAct — catch-up script for migrations 0019 → 0023.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It is
-- the same content as the five numbered migrations, made fully idempotent
-- (safe to run twice, safe to run if some were already applied).
--
-- Why it matters: the app selects these columns. A missing column makes a
-- page query return nothing, which the app reads as "course not found" — so
-- Setup, Check-In, and the deck list 404 until this runs.
--
--   0019  profile_answers        — professors' own icebreaker answers
--   0020  profiles.linkedin_url
--   0021  lecture_decks.position — drag-to-reorder decks
--   0022  courses.term_start / term_end — first and last day of class
--   0023  handle_new_user()      — honor the role chosen at sign-up

-- ---------- 0019: profile-level icebreaker answers ----------

create table if not exists public.profile_answers (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  field_key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, field_key)
);

alter table public.profile_answers enable row level security;

drop policy if exists profile_answers_own on public.profile_answers;
create policy profile_answers_own on public.profile_answers for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------- 0020: LinkedIn on the profile ----------

alter table public.profiles
  add column if not exists linkedin_url text;

-- ---------- 0021: manual deck order ----------

alter table public.lecture_decks
  add column if not exists position int;

with ordered as (
  select
    id,
    (row_number() over (partition by course_id order by created_at desc)) - 1 as rn
  from public.lecture_decks
)
update public.lecture_decks d
   set position = o.rn
  from ordered o
 where d.id = o.id
   and d.position is null;

alter table public.lecture_decks
  alter column position set default 0;

-- ---------- 0022: term start/end dates ----------

alter table public.courses
  add column if not exists term_start date,
  add column if not exists term_end date;

-- ---------- 0023: honor the role chosen at sign-up ----------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    case
      when new.raw_user_meta_data->>'role' = 'professor' then 'professor'
      else 'student'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- Verify ----------
-- Should return 5 rows, all ok = true. A false means that piece didn't apply.

select 'profile_answers table' as check_name,
       to_regclass('public.profile_answers') is not null as ok
union all
select 'profiles.linkedin_url', exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'linkedin_url')
union all
select 'lecture_decks.position', exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'lecture_decks'
    and column_name = 'position')
union all
select 'courses.term_start', exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'courses'
    and column_name = 'term_start')
union all
select 'courses.term_end', exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'courses'
    and column_name = 'term_end');
