-- ClassAct — 0025: self-reported absences.
-- Students tell ClassAct they'll miss class instead of emailing the professor.
-- The AI applies the course's attendance policy and records a verdict; the
-- professor only hears about appeals. Documentation a student attaches is
-- assessed in memory and never stored — only its kind and an authenticity
-- score persist.
--
-- RLS here is professor-only: they can read and write every absence in their
-- own courses, and nobody else can touch the table from a browser. Students
-- have no policy at all — the row carries scores meant for the professor and
-- RLS can't restrict columns — so student reads and writes go through server
-- actions that authenticate first and then use the service role.

-- The professor's policy, one jsonb on the course:
-- { text, excusedCategories[], advanceNoticeHours, docsRequiredFor[], freeUnexcused }
alter table public.courses
  add column if not exists attendance_policy jsonb not null default '{}'::jsonb;

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  absence_date date not null,
  category text not null check (category in (
    'athletics','interview','university_event','religious',
    'family','illness','bereavement','other'
  )),
  explanation text not null,
  submitted_at timestamptz not null default now(),
  -- Hours between submission and the meeting start on absence_date, in the
  -- course timezone. Negative = submitted after class began. Null when the
  -- course has no schedule to measure against.
  advance_hours numeric,

  -- Documentation: assessed, never stored.
  has_documentation boolean not null default false,
  documentation_kind text,          -- "clinic visit summary", never contents
  ai_doc_authenticity int check (ai_doc_authenticity between 0 and 100),

  -- The AI's read.
  ai_verdict text not null check (ai_verdict in ('excused','unexcused')),
  ai_legitimacy int not null check (ai_legitimacy between 0 and 100),
  ai_summary text not null,          -- one neutral line for the professor's table
  ai_reason text not null,           -- 1–2 sentences the student sees
  ai_flags text[] not null default '{}',

  -- Appeal and the professor's decision.
  appeal_note text,
  appealed_at timestamptz,
  professor_verdict text check (professor_verdict in ('excused','unexcused')),
  professor_note text,
  decided_at timestamptz,

  -- Checked into another ClassAct class on the same date (which one is not
  -- recorded). Set at check-in time or at submission, whichever comes second.
  attended_elsewhere boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, absence_date)
);

create index if not exists idx_absences_course_date
  on public.absences(course_id, absence_date desc);
create index if not exists idx_absences_enrollment
  on public.absences(enrollment_id);

alter table public.absences enable row level security;

-- Professors only. A student's own rows carry ai_legitimacy and
-- ai_doc_authenticity, and RLS is row-scoped rather than column-scoped —
-- a "select *" from the browser would hand the student the scores the
-- design says are for the professor alone, and tell them exactly how
-- convincing their story was. Students read their absences through
-- listMyAbsences(), which returns only verdict, reason, and their own text.
drop policy if exists absences_select on public.absences;
create policy absences_select on public.absences for select
  using (public.is_course_professor(course_id));

drop policy if exists absences_professor_all on public.absences;
create policy absences_professor_all on public.absences for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));
