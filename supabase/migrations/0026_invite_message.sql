-- ClassAct — 0026: editable invite message + per-student send receipts.
--
-- Two problems, one migration.
--
-- (1) The invite email body was hardcoded in the app, so a professor could
-- read it but never change it. These columns hold the professor's own subject
-- and body. Null means "use the shipped default" — which is exactly how every
-- existing course behaves today, so nothing changes until someone edits it.
--
-- (2) A send used to be fire-and-forget: the roster recorded that a student
-- was "invited" but not whether the email actually left the building. When
-- Resend's rate limit rejected the tail of a large roster, nobody could tell
-- who got one. invited_at is the receipt; invite_error is why it failed. Both
-- are overwritten on every attempt, so they always describe the latest try.

alter table public.courses
  add column if not exists invite_subject text,
  add column if not exists invite_message text;

alter table public.enrollments
  add column if not exists invited_at timestamptz,
  add column if not exists invite_error text;

-- Finding "who still needs an invite" is the roster's most common question
-- once a class is large enough for the answer to be non-obvious.
create index if not exists enrollments_course_invited_at_idx
  on public.enrollments (course_id, invited_at);
