-- ClassAct — 0037: the professor's order, the points it awards, and taste in
-- plain words.
--
-- Tasty Grading could rank submissions and letter them, but the professor
-- could never say "no, that one is better" — the Bradley-Terry fit owned the
-- order, and the only lever was casting more pairwise votes. It also produced
-- letters and nothing else, so `points` (0033) sat unread. This migration
-- carries the three facts that were missing.
--
-- Design constraints this migration honors:
--
--   * final_rank is a SEPARATE column from rank, not a rewrite of it. rank
--     stays the model's draft (it still feeds the histogram and pair
--     suggestions); final_rank is the professor's materialized order, written
--     when peer review closes and never touched by recomputeRanking again.
--     Decision 6 of the plan is enforced by column shape rather than by
--     call-site discipline — a stray recompute CANNOT clobber a drag.
--
--   * points_awarded is written only at publish, from the durable inputs
--     (order + bands + mode + points). Everything the cockpit shows before
--     that is a preview computed by the same pure function (src/lib/bands.ts).
--     One moment of truth, and it is the moment the professor consents to.
--
--   * No RLS changes, deliberately. The rankings_select policy (0013) already
--     gives the professor everything and gives a student their own row ONLY
--     once published_at is set. Policies are table-scoped, so both new columns
--     inherit that publish gate and the FERPA rule for free — same reasoning
--     as the 0033 comment.
--
--   * taste_files.body is nullable, and null MEANS something: a row written
--     under the old structured editor. Those rows are read back as prose in
--     app code (src/lib/tasteprose.ts) rather than converted here — the
--     student's own criteria and wording survive untouched.

-- ---------- 1. rankings: the professor's order and the points it pays ----------

alter table public.rankings
  -- The materialized order. Null = not materialized yet (peer review is still
  -- running); the cockpit renders final_rank ?? rank so the list never jumps
  -- when the first drag makes it durable.
  add column if not exists final_rank int,
  -- Numeric, like assignments.points: real gradebooks carry 3.50 and 102.08.
  -- Null = no point value awarded (a labels-only assignment, or not yet
  -- published).
  add column if not exists points_awarded numeric;

-- Deliberately NO unique index on (assignment_id, final_rank), though the
-- values are in fact a permutation. Reordering swaps positions between rows,
-- and a non-deferrable unique index is checked as each row is written — so
-- the single bulk upsert that makes a reorder atomic would trip over itself
-- halfway through (23505) on a perfectly valid new order. A partial index
-- cannot be declared deferrable, and the alternative (null every row, then
-- write) leaves the professor's order erased if the second statement fails.
-- The invariant is held where it can be held honestly: writeOrder() always
-- rewrites the whole list as 1..N from an array, never a single position.
create index if not exists idx_rankings_final_rank
  on public.rankings(assignment_id, final_rank) where final_rank is not null;

-- ---------- 2. taste_files: free-flowing prose ----------

alter table public.taste_files
  -- What makes the work good, in the student's own words — dictated or
  -- pasted, not entered into a grid. Null = a legacy structured row.
  add column if not exists body text;

-- ---------- 3. The professor's private criteria become a taste file ----------
-- settings.gradingInstructions was the ai_only rubric source and dead weight
-- in tasty mode. The professor benchmark row (enrollment_id null) has existed
-- since 0013 with nothing writing it; this is the same text in the place the
-- rubric corpus already reads from, tagged [PROFESSOR].

insert into public.taste_files
  (assignment_id, course_id, body, is_default_untouched)
select a.id, a.course_id, a.settings->>'gradingInstructions', false
from public.assignments a
where coalesce(a.settings->>'gradingInstructions', '') <> ''
  and not exists (
    select 1 from public.taste_files t
     where t.assignment_id = a.id and t.enrollment_id is null
  );

-- ---------- 4. Cut points become band labels ----------
-- A band is now a slice of the ranked list, so a 0-100 threshold no longer
-- has a meaning. The letters do: they become labels, and the professor types
-- what each band is worth. Where the lines FALL is not backfilled — that
-- depends on this class's live score distribution, so the app derives it from
-- the old thresholds on first render and persists it on the first save.

update public.assignments
   set settings = settings || jsonb_build_object(
     'bands',
     (select jsonb_agg(
                jsonb_build_object('label', cp->>'letter', 'value', null)
                order by (cp->>'min')::numeric desc)
        from jsonb_array_elements(settings->'cutPoints') cp)
   )
 where settings ? 'cutPoints'
   and not (settings ? 'bands')
   and jsonb_typeof(settings->'cutPoints') = 'array'
   and jsonb_array_length(settings->'cutPoints') > 0;

-- Same conversion for a course-level template, which layers under every new
-- assignment in that course.
update public.courses
   set grading_defaults = grading_defaults || jsonb_build_object(
     'bands',
     (select jsonb_agg(
                jsonb_build_object('label', cp->>'letter', 'value', null)
                order by (cp->>'min')::numeric desc)
        from jsonb_array_elements(grading_defaults->'cutPoints') cp)
   )
 where grading_defaults ? 'cutPoints'
   and not (grading_defaults ? 'bands')
   and jsonb_typeof(grading_defaults->'cutPoints') = 'array'
   and jsonb_array_length(grading_defaults->'cutPoints') > 0;
