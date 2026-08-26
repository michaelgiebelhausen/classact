-- 0033: what an assignment says, what it's worth, and who it is in Canvas.
--
-- Until now the only way a professor could state the brief was uploading a
-- PDF, so writing two sentences meant opening a word processor first;
-- `instructions` removes that. `points` is a plain value the assignment
-- carries — it deliberately does NOT feed cut points, letters, or ranking
-- (that's the speed-grader work), it just stops an assignment from being
-- worth nothing at all.
--
-- The three canvas_* columns are identity for a future gradebook CSV
-- export. Grades reach Canvas as a CSV the professor uploads by hand, not
-- as an API write, so nothing here implies a token. See
-- docs/canvas-assignment-fields-plan.md.

alter table public.assignments
  -- Student-facing brief. NOT settings.gradingInstructions, which is the
  -- professor's private AI grading criteria for ai_only assignments.
  add column if not exists instructions text not null default '',
  -- Nullable on purpose, against the house not-null-default habit: null is
  -- "no point value set", which is a different fact from "worth zero".
  -- numeric, not int — real gradebooks carry 3.50 and 4.25.
  add column if not exists points numeric,
  -- The Canvas column this assignment maps to. Retained in a CSV header as
  -- "Title (2338931)" so Canvas updates in place instead of creating a
  -- duplicate column.
  add column if not exists canvas_assignment_id text,
  -- When we last GENERATED a CSV. Never proof Canvas received it — the
  -- professor uploads by hand and we get no confirmation.
  add column if not exists canvas_exported_at timestamptz;

alter table public.enrollments
  -- The Canvas user id: the "ID" column of a gradebook CSV, and how Canvas
  -- matches a row to a student. Email is fine for importing a roster and
  -- wrong for writing grades back — a changed campus address or the
  -- Google-twin collision handled in 0027 would post a grade to the wrong
  -- student's record.
  add column if not exists canvas_user_id text;

-- No RLS changes: the assignments_select / assignments_write policies from
-- 0013 are table-scoped and already cover new columns, as are the
-- enrollment policies.
