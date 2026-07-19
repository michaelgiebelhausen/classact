-- ClassAct — Tasty Grading (AI/Peer/Instructor grading), schema.
-- Spec: docs/tasty-grading-plan.md. Individual assignments with taste files,
-- emergent rubric themes, AI scores, pairwise comparisons, and rankings.
-- Principles enforced at this layer: students read only their own rows
-- (FERPA); rankings become student-visible only after publish; peers never
-- read classmates' submissions directly (server-signed URLs gate pair PDFs).

-- ---------- Tables ----------

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  -- Assignment brief PDF in the assignment-docs bucket ({courseId}/brief/…).
  storage_path text,
  deadline timestamptz not null,
  peer_close_at timestamptz not null,
  -- pairMix / professorWeight / distinctivenessWeight / cutPoints…
  settings jsonb not null default '{}'::jsonb,
  state text not null default 'open'
    check (state in ('open','analyzing','peer_review','finalizing','published')),
  -- Resumable batch progress for the analysis engine.
  analysis jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- One taste file per student per assignment; enrollment_id null = the
-- professor's optional benchmark taste file (at most one per assignment).
create table if not exists public.taste_files (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id) on delete cascade,
  -- [{ name, standard }] — the student's criteria.
  criteria jsonb not null default '[]'::jsonb,
  bar_statement text not null default '',
  -- False once the student has changed anything from the AI default.
  is_default_untouched boolean not null default true,
  first_edit_at timestamptz,
  last_edit_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assignment_id, enrollment_id)
);
create unique index if not exists taste_files_professor_one
  on public.taste_files(assignment_id) where enrollment_id is null;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  -- {courseId}/sub/{enrollmentId}/{uuid}.pdf in the assignment-docs bucket.
  storage_path text not null,
  note text not null default '',
  submitted_at timestamptz not null default now(),
  last_edit_at timestamptz not null default now(),
  unique (assignment_id, enrollment_id)
);

-- Emergent rubric: themes are constructs, items are students' own sentences.
create table if not exists public.rubric_themes (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  description text not null default '',
  provenance text not null default 'class'
    check (provenance in ('professor','class','both')),
  -- [{ quote, enrollment_id }] — anonymized when shown to students.
  items jsonb not null default '[]'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_scores (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  -- [{ themeId, score, evidence }] on a 0–10 anchored scale.
  theme_scores jsonb not null default '[]'::jsonb,
  overall numeric not null default 0,
  -- Did the work meet the student's own taste file?
  own_bar numeric,
  -- Distinctive (10) ↔ Generic (0); convergence, never an accusation.
  distinctiveness numeric,
  summary text not null default '',
  created_at timestamptz not null default now()
);

-- Assigned peer pairs AND professor spot-checks, one table. judge null =
-- professor. verdict −2..+2, left-to-right = "right is clearly worse" (−2)
-- … "right is clearly better" (+2); null = not yet decided.
create table if not exists public.comparisons (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  judge_enrollment_id uuid references public.enrollments(id) on delete cascade,
  left_submission_id uuid not null references public.submissions(id) on delete cascade,
  right_submission_id uuid not null references public.submissions(id) on delete cascade,
  pair_type text not null
    check (pair_type in ('exceptional','self','refine','professor')),
  position int not null default 0,
  verdict int check (verdict between -2 and 2),
  assigned_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists idx_comparisons_assignment on public.comparisons(assignment_id);
create index if not exists idx_comparisons_judge on public.comparisons(judge_enrollment_id);

-- Current ranking state per submission (recomputed as comparisons arrive).
create table if not exists public.rankings (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  bt_score numeric not null default 0,
  rank int not null default 0,
  letter text,
  updated_at timestamptz not null default now()
);

-- Time spent reviewing the consensus rubric (a statistic in its own right).
create table if not exists public.rubric_views (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  seconds int not null default 0,
  first_viewed_at timestamptz not null default now(),
  unique (assignment_id, enrollment_id)
);

-- Course-level grading defaults (cut points, peer window, weights).
alter table public.courses
  add column if not exists grading_defaults jsonb not null default '{}'::jsonb;

create index if not exists idx_assignments_course on public.assignments(course_id);
create index if not exists idx_taste_files_assignment on public.taste_files(assignment_id);
create index if not exists idx_submissions_assignment on public.submissions(assignment_id);
create index if not exists idx_rubric_themes_assignment on public.rubric_themes(assignment_id);
create index if not exists idx_rankings_assignment on public.rankings(assignment_id);

-- ---------- RLS ----------

alter table public.assignments enable row level security;
alter table public.taste_files enable row level security;
alter table public.submissions enable row level security;
alter table public.rubric_themes enable row level security;
alter table public.ai_scores enable row level security;
alter table public.comparisons enable row level security;
alter table public.rankings enable row level security;
alter table public.rubric_views enable row level security;

create policy assignments_select on public.assignments for select
  using (public.is_course_member(course_id));
create policy assignments_write on public.assignments for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Taste files: yours, or the professor's view of everything. The professor
-- benchmark row (enrollment_id null) falls under the professor policy.
create policy taste_files_select on public.taste_files for select
  using (
    public.is_course_professor(course_id)
    or (enrollment_id is not null and public.owns_enrollment(enrollment_id))
  );
create policy taste_files_student_write on public.taste_files for all
  using (enrollment_id is not null and public.owns_enrollment(enrollment_id))
  with check (enrollment_id is not null and public.owns_enrollment(enrollment_id));
create policy taste_files_professor_write on public.taste_files for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Submissions: yours + professor. Peers never read rows directly — pair
-- PDFs are served through server-signed URLs after pair validation.
create policy submissions_select on public.submissions for select
  using (
    public.is_course_professor(course_id) or public.owns_enrollment(enrollment_id)
  );
create policy submissions_write on public.submissions for all
  using (public.owns_enrollment(enrollment_id))
  with check (public.owns_enrollment(enrollment_id));

-- The emergent rubric is the class's shared artifact.
create policy rubric_themes_select on public.rubric_themes for select
  using (public.is_course_member(course_id));
create policy rubric_themes_write on public.rubric_themes for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- AI scores: professor always; the student sees their own once published.
create policy ai_scores_select on public.ai_scores for select
  using (
    public.is_course_professor(course_id)
    or exists (
      select 1 from public.submissions s
      join public.assignments a on a.id = s.assignment_id
      where s.id = submission_id
        and public.owns_enrollment(s.enrollment_id)
        and a.published_at is not null
    )
  );
create policy ai_scores_professor_write on public.ai_scores for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Comparisons: judges see and answer their own assigned pairs; professor all.
create policy comparisons_select on public.comparisons for select
  using (
    public.is_course_professor(course_id)
    or (judge_enrollment_id is not null and public.owns_enrollment(judge_enrollment_id))
  );
create policy comparisons_judge_update on public.comparisons for update
  using (judge_enrollment_id is not null and public.owns_enrollment(judge_enrollment_id))
  with check (judge_enrollment_id is not null and public.owns_enrollment(judge_enrollment_id));
create policy comparisons_professor_write on public.comparisons for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Rankings: professor always; your own row once published. Never a
-- classmate's (FERPA).
create policy rankings_select on public.rankings for select
  using (
    public.is_course_professor(course_id)
    or exists (
      select 1 from public.submissions s
      join public.assignments a on a.id = s.assignment_id
      where s.id = submission_id
        and public.owns_enrollment(s.enrollment_id)
        and a.published_at is not null
    )
  );
create policy rankings_professor_write on public.rankings for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

create policy rubric_views_select on public.rubric_views for select
  using (public.is_course_professor(course_id) or public.owns_enrollment(enrollment_id));
create policy rubric_views_write on public.rubric_views for all
  using (public.owns_enrollment(enrollment_id))
  with check (public.owns_enrollment(enrollment_id));

-- ---------- Storage: assignment-docs bucket ----------
-- {courseId}/brief/{uuid}.pdf        — professor writes, course reads
-- {courseId}/sub/{enrollmentId}/{uuid}.pdf — student writes own, professor
-- reads; peers get pair PDFs via short-lived server-signed URLs only.

insert into storage.buckets (id, name, public)
values ('assignment-docs', 'assignment-docs', false)
on conflict (id) do nothing;

drop policy if exists assignment_docs_professor_all on storage.objects;
create policy assignment_docs_professor_all on storage.objects for all
  using (
    bucket_id = 'assignment-docs'
    and public.is_course_professor(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'assignment-docs'
    and public.is_course_professor(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists assignment_docs_brief_read on storage.objects;
create policy assignment_docs_brief_read on storage.objects for select
  using (
    bucket_id = 'assignment-docs'
    and (storage.foldername(name))[2] = 'brief'
    and public.is_course_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists assignment_docs_student_own on storage.objects;
create policy assignment_docs_student_own on storage.objects for all
  using (
    bucket_id = 'assignment-docs'
    and (storage.foldername(name))[2] = 'sub'
    and public.owns_enrollment(((storage.foldername(name))[3])::uuid)
  )
  with check (
    bucket_id = 'assignment-docs'
    and (storage.foldername(name))[2] = 'sub'
    and public.owns_enrollment(((storage.foldername(name))[3])::uuid)
  );
