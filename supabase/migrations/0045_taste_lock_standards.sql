-- ClassAct — 0045: locked taste files and the standards comparison.
--
-- Two capabilities for co-created assignments (taste sourced from the class,
-- not the instructor alone):
--
--   1. A student LOCKS their taste file before the instructor's taste is
--      revealed and before they can upload. The lock is the whole integrity
--      claim — "I committed to my own standard before seeing yours" — so a
--      locked taste file must be frozen. RLS (0013) grants a student FOR ALL
--      on their own taste_files row, meaning they can UPDATE it directly
--      through PostgREST; a server-action check alone would not bind that.
--      So the freeze lives in the database, as a trigger.
--
--   2. The AI compares each student's taste to the instructor's — is the bar
--      they set for themselves above, at, or below the instructor's? — and
--      that score feeds their metrics. It lives on ai_scores, NOT taste_files,
--      on purpose: the ai_scores RLS (0013) already hides a student's row until
--      published_at is set and only lets the professor/service role write it,
--      so standards_score inherits that publish gate and write protection for
--      free — the same reasoning 0037 used for final_rank / points_awarded.
--      Cost accepted: a student who locks but never submits has no ai_scores
--      row and so no standards score; the report and metrics key on submissions
--      anyway.
--
-- No enum/settings migration: the two grading axes (peerReview, tasteSource)
-- live in assignments.settings JSONB and resolve from the legacy gradingMode
-- key in app code.

-- ---------- 1. taste_files: the lock ----------

alter table public.taste_files
  -- When the student sealed their taste file. Null = unlocked (still editable).
  -- Write-once, set by lockTasteFile; content is frozen from that moment.
  add column if not exists locked_at timestamptz;

-- ---------- 2. ai_scores: the standards comparison ----------

alter table public.ai_scores
  -- 0–10, anchored at 5 = the student's bar matches the instructor's; >5 = they
  -- hold themselves to a higher standard, <5 = lower. An assessment of the
  -- TASTE, not the work (own_bar is the work). Null = not computed (instructor-
  -- sourced assignment, or no qualifying student taste).
  add column if not exists standards_score numeric,
  add column if not exists standards_note text not null default '';

-- ---------- 3. Freeze a locked taste file (database backstop) ----------

create or replace function public.taste_files_lock_guard()
returns trigger
language plpgsql
as $$
begin
  -- Content is frozen once locked. Only the prose/legacy-grid fields are
  -- protected — those are what the student committed and what the standards
  -- comparison reads.
  if OLD.locked_at is not null then
    if NEW.body is distinct from OLD.body
       or NEW.criteria is distinct from OLD.criteria
       or NEW.bar_statement is distinct from OLD.bar_statement then
      raise exception 'taste file is locked and cannot be edited';
    end if;
    -- The lock is write-once: never changed, never cleared.
    if NEW.locked_at is distinct from OLD.locked_at then
      raise exception 'locked_at cannot change once set';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists taste_files_lock_guard on public.taste_files;
create trigger taste_files_lock_guard
  before update on public.taste_files
  for each row execute function public.taste_files_lock_guard();
