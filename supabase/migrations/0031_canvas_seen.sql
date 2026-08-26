-- ClassAct — 0031: only call someone a Canvas departure if Canvas ever had them.
--
-- 0030 inferred "no longer on Canvas" from absence alone, which cannot tell
-- "was on the Canvas roster and left" apart from "was never on it". Students
-- who joined with a course code — a personal Gmail, no Canvas relationship
-- whatsoever — were listed as drop candidates on every sync. Meaningless, and
-- worse than meaningless: it buries the real drops among people who never left
-- because they were never there.
--
-- Absence is not a fact about a row; having been seen is. `canvas_seen_at`
-- records that a Canvas sync actually matched or imported this student, and
-- only rows carrying it can ever be flagged as missing.

alter table public.enrollments
  add column if not exists canvas_seen_at timestamptz;

comment on column public.enrollments.canvas_seen_at is
  'Last time a Canvas sync matched or imported this student. Null means Canvas has never listed them (joined by course code, or added by CSV), so they can never be a Canvas departure.';

-- One-time backfill, because rows predating this column carry no record of
-- where they came from and the next sync can only mark people who are in
-- Canvas *now* — never the summer imports who already dropped, who are
-- precisely the ones worth finding.
--
-- The signal: a roster row whose NAME is an email address was created by
-- /auth/join for someone with no Canvas row (see `isEmailAddress` in
-- lib/names.ts, which documents the same rule). A Canvas import always
-- carries the name Canvas holds.
--
-- This is a heuristic and it is stated as one. It can wrongly include a
-- CSV-imported student, who will show up as a drop candidate and simply not
-- be ticked — the same false positive that already existed, on a much smaller
-- set. It cannot wrongly include a join-code student, which is the bug.
update public.enrollments
   set canvas_seen_at = created_at
 where canvas_seen_at is null
   and roster_name !~ '^\S+@\S+\.\S+$';

-- Clear the flags 0030 raised against rows Canvas never had. These are the
-- join-code students that should never have appeared in the section.
update public.enrollments
   set canvas_missing_since = null
 where canvas_missing_since is not null
   and canvas_seen_at is null;
