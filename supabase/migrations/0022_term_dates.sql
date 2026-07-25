-- ClassAct — 0022: term start/end dates on a course.
-- A weekly schedule alone has no idea the semester ended, so check-in would
-- keep auto-opening every Monday through winter break. These bounds are
-- inclusive calendar dates read in the course's own timezone; null means
-- unbounded, which is exactly how every existing course behaves today.

alter table public.courses
  add column if not exists term_start date,
  add column if not exists term_end date;
