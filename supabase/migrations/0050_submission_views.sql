-- When the professor last opened each submission in the grading cockpit, so
-- the ranked list can tint the rows they've already read.
--
-- Its own table rather than a column on submissions: students can read and
-- write their own submission rows, and whether the professor has looked yet
-- is the professor's business, not something a student should see or set.
--
-- One row per submission, overwritten on every open. A row counts as read
-- only while viewed_at is later than the submission's last_edit_at, so work
-- a student replaces after it was read shows up unread again.

create table if not exists public.submission_views (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  viewed_at timestamptz not null default now()
);

create index if not exists idx_submission_views_assignment
  on public.submission_views(assignment_id);

alter table public.submission_views enable row level security;

-- The professor reads; writes go through the server's service-role client
-- when the professor opens a submission, so there is no write policy.
create policy submission_views_select on public.submission_views for select
  using (public.is_course_professor(course_id));
