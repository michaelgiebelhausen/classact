-- ClassAct — Metrics dashboard v2: shout-outs, professor participation
-- cockpit (weights + student comparisons + flags).
-- Spec: docs/metrics-dashboard-plan.md.
-- Visibility (Mike, 2026-07-19): a shout-out is private to its recipient;
-- the professor sees all. Flags and participation comparisons are
-- professor-only.

-- ---------- Shout-outs ----------

create table if not exists public.shout_outs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  giver_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  recipient_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  context text not null default 'general'
    check (context in ('general','exercise','project','peer_review')),
  -- For peer_review: the comparison id; for project/exercise: optional ref.
  context_id uuid,
  message text not null default '',
  created_at timestamptz not null default now(),
  check (giver_enrollment_id <> recipient_enrollment_id)
);
create index if not exists idx_shoutouts_course on public.shout_outs(course_id);
create index if not exists idx_shoutouts_recipient on public.shout_outs(recipient_enrollment_id);

-- ---------- Professor participation cockpit ----------

-- Professor's per-course competency weights (key -> 0..1).
alter table public.courses
  add column if not exists participation_weights jsonb not null default '{}'::jsonb;

-- Side-by-side student comparisons (the participation conjoint).
create table if not exists public.participation_comparisons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  left_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  right_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  -- −2..+2, positive = right student participates better.
  verdict int not null check (verdict between -2 and 2),
  created_at timestamptz not null default now()
);
create index if not exists idx_participation_comparisons_course
  on public.participation_comparisons(course_id);

-- Professor-private flags: suspected gaming / maladaptive behavior.
create table if not exists public.student_flags (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_student_flags_course on public.student_flags(course_id);

-- ---------- RLS ----------

alter table public.shout_outs enable row level security;
alter table public.participation_comparisons enable row level security;
alter table public.student_flags enable row level security;

-- Shout-outs: recipient sees theirs, giver sees what they gave,
-- professor sees all. Members give (server actions validate context).
create policy shout_outs_select on public.shout_outs for select
  using (
    public.is_course_professor(course_id)
    or public.owns_enrollment(recipient_enrollment_id)
    or public.owns_enrollment(giver_enrollment_id)
  );
create policy shout_outs_insert on public.shout_outs for insert
  with check (
    public.is_course_member(course_id)
    and public.owns_enrollment(giver_enrollment_id)
  );
create policy shout_outs_professor_all on public.shout_outs for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Participation comparisons + flags: professor only, in and out.
create policy participation_comparisons_professor on public.participation_comparisons
  for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

create policy student_flags_professor on public.student_flags for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));
