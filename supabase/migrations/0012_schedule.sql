-- ClassAct — Class schedule: meeting days/times on the course, powering
-- automatic session opening. No cron needed: the check-in page opens the
-- session lazily when anyone loads it inside the scheduled window.
-- Existing courses keep meeting_days = '{}' (no schedule → manual open only).

alter table public.courses
  add column if not exists meeting_days smallint[] not null default '{}',
  add column if not exists meeting_start time,
  add column if not exists meeting_end time,
  add column if not exists timezone text,
  add column if not exists auto_open boolean not null default true;

comment on column public.courses.meeting_days is
  'Weekdays the class meets, 0 = Sunday … 6 = Saturday (JS Date.getDay convention).';
comment on column public.courses.timezone is
  'IANA timezone the meeting times are anchored to, e.g. America/New_York.';
