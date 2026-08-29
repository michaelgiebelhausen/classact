-- 0041: Ask the TA is opt-in per course.
--
-- One OpenRouter key covers every AI task, so before this column existed,
-- connecting a key to use the grader silently switched on the student-facing
-- TA too — open-ended chat spending on a key the professor connected for
-- something else. Default FALSE: the professor flips it on deliberately,
-- from the Ask TA page, after seeing what it is.
alter table public.courses
  add column if not exists ta_enabled boolean not null default false;
