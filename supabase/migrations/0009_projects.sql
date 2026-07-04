-- ClassAct — Projects (team assignments).
-- A project is a professor-uploaded assignment PDF. AI parses it into a task
-- template (project_tasks). Students self-organize into per-project teams;
-- each team gets its own working copy of the tasks (team_tasks) on a simple
-- board: unassigned -> a column per member -> done. Estimated minutes are the
-- points currency; actual minutes (entered at completion) refine it. Teammates
-- can flag a "done" task that wasn't really finished. Contribution analytics
-- run on completed, unflagged minutes.
--
-- This one migration carries the whole feature's schema; the UI ships in
-- phases on top of it.

-- ---------- Tables ----------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  storage_path text,               -- assignment PDF in the project-docs bucket
  page_count int,
  due_date date,
  target_team_size int check (target_team_size between 1 and 20),
  contract_text text not null default '',  -- default team contract; seeds each team's copy
  status text not null default 'draft' check (status in ('draft','open')),
  created_at timestamptz not null default now()
);

-- The AI-parsed task template. A starting point: copied onto each team's board
-- when the team forms, and the team owns its copy from there.
create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text,
  estimated_minutes int not null default 30 check (estimated_minutes between 1 and 6000),
  position int not null default 1,
  source text not null default 'professor' check (source in ('ai','professor')),
  created_at timestamptz not null default now()
);

create table if not exists public.project_teams (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  contract_text text not null default '',  -- team's own copy, editable by the team
  created_at timestamptz not null default now()
);

-- project_id is denormalized so the database itself enforces one team per
-- student per project (same philosophy as atomic seat claiming).
create table if not exists public.project_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  role text not null default 'member' check (role in ('lead','member')),
  created_at timestamptz not null default now(),
  unique (team_id, enrollment_id),
  unique (project_id, enrollment_id)
);

-- A team's working board. Cards start as copies of project_tasks but belong to
-- the team: they can add ('team' source), edit, re-estimate, and delete.
create table if not exists public.team_tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  source_task_id uuid references public.project_tasks(id) on delete set null,
  title text not null,
  description text,
  estimated_minutes int not null default 30 check (estimated_minutes between 1 and 6000),
  actual_minutes int check (actual_minutes between 1 and 6000),  -- entered at completion
  status text not null default 'unassigned' check (status in ('unassigned','assigned','done')),
  assigned_enrollment_id uuid references public.enrollments(id) on delete set null,
  assigned_by_enrollment_id uuid references public.enrollments(id) on delete set null,
  done_at timestamptz,
  position int not null default 1,
  source text not null default 'team' check (source in ('ai','professor','team')),
  created_at timestamptz not null default now()
);

-- Accountability: any teammate can flag a done task that wasn't really done.
-- Unresolved flags exclude the task from the flagged member's contribution.
create table if not exists public.task_flags (
  id uuid primary key default gen_random_uuid(),
  team_task_id uuid not null references public.team_tasks(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  flagged_by_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

-- Signing the team contract is tracked per member (it's also a board card).
create table if not exists public.team_contract_signatures (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  signed_at timestamptz not null default now(),
  unique (team_id, enrollment_id)
);

-- ---------- Helper: is the caller on this team? ----------
-- (Defined after the tables it references — Postgres validates SQL function
-- bodies at creation time.)

create or replace function public.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from project_team_members m
    join enrollments e on e.id = m.enrollment_id
    where m.team_id = p_team and e.profile_id = auth.uid()
  );
$$;

create index if not exists idx_projects_course on public.projects(course_id);
create index if not exists idx_project_tasks_project on public.project_tasks(project_id);
create index if not exists idx_project_tasks_course on public.project_tasks(course_id);
create index if not exists idx_project_teams_project on public.project_teams(project_id);
create index if not exists idx_project_teams_course on public.project_teams(course_id);
create index if not exists idx_team_members_team on public.project_team_members(team_id);
create index if not exists idx_team_members_enrollment on public.project_team_members(enrollment_id);
create index if not exists idx_team_tasks_team on public.team_tasks(team_id);
create index if not exists idx_team_tasks_course on public.team_tasks(course_id);
create index if not exists idx_team_tasks_assignee on public.team_tasks(assigned_enrollment_id);
create index if not exists idx_task_flags_task on public.task_flags(team_task_id);
create index if not exists idx_task_flags_course on public.task_flags(course_id);
create index if not exists idx_contract_sigs_team on public.team_contract_signatures(team_id);

-- ---------- RLS ----------

alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_teams enable row level security;
alter table public.project_team_members enable row level security;
alter table public.team_tasks enable row level security;
alter table public.task_flags enable row level security;
alter table public.team_contract_signatures enable row level security;

-- Projects: professor full control; students see them once opened.
create policy projects_select on public.projects for select
  using (
    public.is_course_professor(course_id)
    or (status = 'open' and public.is_course_member(course_id))
  );
create policy projects_write on public.projects for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Task template: professor writes; students read once the project is open
-- (there's no answer key here — it's their starting to-do list).
create policy project_tasks_select on public.project_tasks for select
  using (
    public.is_course_professor(course_id)
    or (
      public.is_course_member(course_id)
      and exists (select 1 from projects p
                  where p.id = project_id and p.status = 'open')
    )
  );
create policy project_tasks_write on public.project_tasks for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Teams: visible to the whole course (students need to see who to join);
-- students create them; the team (or professor) renames/edits its contract.
create policy project_teams_select on public.project_teams for select
  using (public.is_course_member(course_id));
create policy project_teams_insert on public.project_teams for insert
  with check (public.is_course_member(course_id));
create policy project_teams_update on public.project_teams for update
  using (public.is_course_professor(course_id) or public.is_team_member(id))
  with check (public.is_course_professor(course_id) or public.is_team_member(id));
create policy project_teams_delete on public.project_teams for delete
  using (public.is_course_professor(course_id));

-- Membership: course-visible rosters; students join/leave for themselves.
create policy team_members_select on public.project_team_members for select
  using (exists (select 1 from project_teams t
                 where t.id = team_id and public.is_course_member(t.course_id)));
create policy team_members_insert on public.project_team_members for insert
  with check (
    public.owns_enrollment(enrollment_id)
    or exists (select 1 from project_teams t
               where t.id = team_id and public.is_course_professor(t.course_id))
  );
create policy team_members_delete on public.project_team_members for delete
  using (
    public.owns_enrollment(enrollment_id)
    or exists (select 1 from project_teams t
               where t.id = team_id and public.is_course_professor(t.course_id))
  );

-- Board cards: the team works its own board; the professor sees every board.
create policy team_tasks_select on public.team_tasks for select
  using (public.is_course_professor(course_id) or public.is_team_member(team_id));
create policy team_tasks_write on public.team_tasks for all
  using (public.is_course_professor(course_id) or public.is_team_member(team_id))
  with check (public.is_course_professor(course_id) or public.is_team_member(team_id));

-- Flags: teammates raise them (as themselves); the professor resolves.
create policy task_flags_select on public.task_flags for select
  using (
    public.is_course_professor(course_id)
    or exists (select 1 from team_tasks tt
               where tt.id = team_task_id and public.is_team_member(tt.team_id))
  );
create policy task_flags_insert on public.task_flags for insert
  with check (
    public.owns_enrollment(flagged_by_enrollment_id)
    and exists (select 1 from team_tasks tt
                where tt.id = team_task_id and public.is_team_member(tt.team_id))
  );
create policy task_flags_update on public.task_flags for update
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Contract signatures: sign for yourself; team + professor can see who has.
create policy contract_sigs_select on public.team_contract_signatures for select
  using (
    public.is_team_member(team_id)
    or exists (select 1 from project_teams t
               where t.id = team_id and public.is_course_professor(t.course_id))
  );
create policy contract_sigs_insert on public.team_contract_signatures for insert
  with check (public.owns_enrollment(enrollment_id) and public.is_team_member(team_id));

-- ---------- Storage: private bucket for assignment PDFs ----------
-- Objects live at `{courseId}/{uuid}.pdf` — same shape as lecture-decks.

insert into storage.buckets (id, name, public)
values ('project-docs', 'project-docs', false)
on conflict (id) do nothing;

drop policy if exists project_docs_professor_all on storage.objects;
create policy project_docs_professor_all on storage.objects for all
  using (
    bucket_id = 'project-docs'
    and public.is_course_professor(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'project-docs'
    and public.is_course_professor(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists project_docs_member_read on storage.objects;
create policy project_docs_member_read on storage.objects for select
  using (
    bucket_id = 'project-docs'
    and public.is_course_member(((storage.foldername(name))[1])::uuid)
  );

-- ---------- Realtime: live board updates for teammates ----------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'team_tasks'
  ) then
    alter publication supabase_realtime add table public.team_tasks;
  end if;
end $$;
