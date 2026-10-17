-- ClassAct — 0051: an editable, weighted rubric and the professor's library.
--
-- The rubric used to be something the AI produced at the deadline and nobody
-- touched. Now it is a grid the professor owns at any point: drafted from
-- their taste file while the assignment is open, editable before and after
-- grading, and regraded against on request.
--
--   1. rubric_themes.weight — how much each criterion counts. The ranking's
--      prior is the weighted mean of the per-criterion scores, so a weight
--      change re-ranks with no AI call. Relative numbers, not forced to sum to
--      100; the UI shows each as a share. Existing rows default to 1, i.e.
--      equal weights.
--
--   2. saved_rubrics — a professor's own reusable rubrics, across every course
--      they teach. Saved from an assignment's grid, imported into another.
--      Criteria are copied, never linked: editing a saved rubric must not
--      quietly change an assignment that was already graded against it.

-- ---------- 1. Weights ----------

alter table public.rubric_themes
  add column if not exists weight numeric not null default 1
    check (weight >= 0);

-- ---------- 2. The library ----------

create table if not exists public.saved_rubrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- [{ name, description, weight }] in display order.
  criteria jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Saving under an existing name replaces it rather than piling up copies.
  unique (owner_id, name)
);

create index if not exists idx_saved_rubrics_owner on public.saved_rubrics(owner_id);

alter table public.saved_rubrics enable row level security;

-- Yours alone: a rubric library is personal teaching material, not course data.
create policy saved_rubrics_owner on public.saved_rubrics for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
