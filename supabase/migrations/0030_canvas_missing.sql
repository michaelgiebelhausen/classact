-- ClassAct — 0030: remember who Canvas stopped listing.
--
-- "No longer on Canvas" is not a fact the database can derive; it is learned
-- by calling Canvas. Until now a sync computed it, handed it to the professor
-- as a one-time preview, and forgot it — so the answer existed only in the
-- seconds after a sync, and closing the tab lost it.
--
-- Recording it per student lets the roster carry a standing "no longer on
-- Canvas" section that survives a reload, instead of a panel the professor has
-- to catch. The timestamp (rather than a boolean) is what makes it honest:
-- it says WHEN Canvas stopped listing them, so a professor can tell a student
-- who vanished this morning from one who left in week two.
--
-- Cleared, not just set: a student who reappears in Canvas — re-added, or a
-- section finally synced — has this wiped, so a token hiccup that briefly
-- hides a section repairs itself on the next good sync rather than leaving a
-- permanent accusation on the row.

alter table public.enrollments
  add column if not exists canvas_missing_since timestamptz;

comment on column public.enrollments.canvas_missing_since is
  'When a Canvas sync first failed to find this student. Null when Canvas lists them, or when they were never expected to be there (CSV/join-code additions before their first sync match).';

-- Only ever a handful per course, but the roster page filters on it every
-- load for every class.
create index if not exists idx_enrollments_canvas_missing
  on public.enrollments (course_id)
  where canvas_missing_since is not null;
