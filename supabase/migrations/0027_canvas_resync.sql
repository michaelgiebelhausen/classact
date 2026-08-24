-- 0027: Canvas resync for add/drop season.
--
-- Two things make "resync" a real feature instead of a re-import:
--
-- 1. The course remembers which Canvas course (and which sections of a
--    cross-listed shell) it was synced from, so resync is one click instead
--    of re-picking the course every time.
-- 2. Enrollments gain a 'dropped' status. Dropping is a status change, never
--    a delete — attendance, participation, and seat history all survive, and
--    a student who re-adds in Canvas is reactivated with their history
--    intact. Every live surface already filters status = 'active', so
--    dropped students disappear from check-in, seat maps, games, and metrics
--    without further changes.

alter table public.courses
  add column if not exists canvas_course_id text,
  add column if not exists canvas_section_ids text[],
  add column if not exists canvas_synced_at timestamptz;

alter table public.enrollments
  add column if not exists dropped_at timestamptz;

alter table public.enrollments
  drop constraint if exists enrollments_status_check;
alter table public.enrollments
  add constraint enrollments_status_check
  check (status in ('invited', 'active', 'dropped'));
