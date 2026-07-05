-- ClassAct — Small-group exercises (one-minute papers).
-- A second in-class Participate activity, alongside think-pair-share polls.
-- The professor poses a prompt; the system assigns students to small groups
-- by where they're sitting (today's check-in seat map); each group prepares
-- one shared written response (the thing they'd put on the whiteboard). Unlike
-- project teams these groups are ephemeral and system-assigned, not chosen.

-- ---------- Tables ----------

create table if not exists public.exercise_rounds (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  session_id uuid references public.class_sessions(id) on delete set null,
  prompt text not null,
  stage text not null default 'open' check (stage in ('open','closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Only one open exercise per course at a time.
create unique index if not exists idx_exercise_rounds_one_open
  on public.exercise_rounds(course_id) where stage = 'open';

create table if not exists public.exercise_groups (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.exercise_rounds(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.exercise_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.exercise_groups(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, enrollment_id)
);

-- One shared response per group — any member can scribe it.
create table if not exists public.exercise_responses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.exercise_groups(id) on delete cascade,
  round_id uuid not null references public.exercise_rounds(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  content text not null default '',
  updated_by_enrollment_id uuid references public.enrollments(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (group_id)
);

create index if not exists idx_exercise_rounds_course on public.exercise_rounds(course_id);
create index if not exists idx_exercise_groups_round on public.exercise_groups(round_id);
create index if not exists idx_exercise_group_members_group on public.exercise_group_members(group_id);
create index if not exists idx_exercise_group_members_enrollment on public.exercise_group_members(enrollment_id);
create index if not exists idx_exercise_responses_round on public.exercise_responses(round_id);

-- ---------- Helper: is the caller in this exercise group? ----------

create or replace function public.is_in_exercise_group(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from exercise_group_members m
    join enrollments e on e.id = m.enrollment_id
    where m.group_id = p_group and e.profile_id = auth.uid()
  );
$$;

-- ---------- RLS ----------

alter table public.exercise_rounds enable row level security;
alter table public.exercise_groups enable row level security;
alter table public.exercise_group_members enable row level security;
alter table public.exercise_responses enable row level security;

-- Rounds & groups & membership: whole class can read (students find their
-- group), professor writes (the system assigns groups on the professor's call).
create policy exercise_rounds_select on public.exercise_rounds for select
  using (public.is_course_member(course_id));
create policy exercise_rounds_write on public.exercise_rounds for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

create policy exercise_groups_select on public.exercise_groups for select
  using (public.is_course_member(course_id));
create policy exercise_groups_write on public.exercise_groups for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

create policy exercise_group_members_select on public.exercise_group_members for select
  using (public.is_course_member(course_id));
create policy exercise_group_members_write on public.exercise_group_members for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Responses: the group's own members read & write theirs; the professor reads
-- every group's (to follow along / project). A group's working draft isn't
-- visible to other groups.
create policy exercise_responses_select on public.exercise_responses for select
  using (
    public.is_course_professor(course_id)
    or public.is_in_exercise_group(group_id)
  );
create policy exercise_responses_write on public.exercise_responses for all
  using (public.is_in_exercise_group(group_id))
  with check (public.is_in_exercise_group(group_id));

-- ---------- Realtime: live round state + group responses ----------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'exercise_rounds'
  ) then
    alter publication supabase_realtime add table public.exercise_rounds;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'exercise_responses'
  ) then
    alter publication supabase_realtime add table public.exercise_responses;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'exercise_group_members'
  ) then
    alter publication supabase_realtime add table public.exercise_group_members;
  end if;
end $$;
