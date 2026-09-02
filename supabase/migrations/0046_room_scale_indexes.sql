-- Indexes for the lookups a whole room performs at once.
--
-- Every student server action starts by resolving the caller's enrollment
-- with exactly this filter (course_id, profile_id, status = 'active'); until
-- now only single-column indexes on course_id and profile_id existed, so the
-- planner picked one and filtered the rest by hand. At 300 students that is
-- the hottest lookup in the schema. The rest support the poll pairing
-- stage, the pairing-history sort, and the "is there an open session?"
-- probe the check-in page and the waiting room run.
--
-- Safe to apply live: plain CREATE INDEX on small tables; no locks worth
-- noticing at this size. Apply in the Supabase SQL editor.

create index if not exists idx_enrollments_course_profile_status
  on public.enrollments(course_id, profile_id, status);

-- shares_active_course's self-join and the membership count on the app
-- layout both filter enrollments by (profile_id, status).
create index if not exists idx_enrollments_profile_status
  on public.enrollments(profile_id, status);

-- StudentFollow and the follow page look up a student's pair with
-- member_ids @> '["<enrollment>"]' — a sequential scan without a GIN index.
create index if not exists idx_poll_pairs_members
  on public.poll_pairs using gin (member_ids jsonb_path_ops);

-- Pairing history, newest first, when assigning new partners.
create index if not exists idx_poll_pairs_course_created
  on public.poll_pairs(course_id, created_at desc);

-- "Is there an open session for this course?" — the check-in page, the
-- waiting-room poll, the course layout, and the follow page all ask.
create index if not exists idx_class_sessions_course_open
  on public.class_sessions(course_id) where closed_at is null;
