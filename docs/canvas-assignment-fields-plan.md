# Canvas assignment fields — plan

Status: designed, not built. 2026-08-26.

## What this is

Two properties Canvas's assignment form has that ClassAct lacks and should
have on its own merits — **instructions** and **points** — plus the three
identity columns a future "get ClassAct grades into Canvas" feature would
need, added now while we're in the schema.

This is deliberately *not* a mirror of Canvas's assignment model. Canvas's
form also carries submission type, peer review, group assignment, anonymous
grading, availability window, display-grade-as, assignment group, and
omit-from-final-grade. Every one of those either duplicates something
ClassAct already does its own (richer) way, or isn't worth its weight. They
were considered and rejected, not overlooked.

## Why these two

**Instructions.** Today the only way a professor states the brief is
uploading a PDF (`assignments.storage_path`). A professor who wants to write
two sentences has to open a word processor first. That's friction on the
most common case.

**Points.** An assignment carries no point value at all. Points is already
implied by the planned speed-grader work (drag-to-rank + cut points +
assignment points).

Note that points is *not* justified by the Canvas export: a CSV upload
carries scores only, and Canvas prompts the professor for points possible
when it creates a new column. Points earns its place through ClassAct's own
grading, and would have to even if Canvas didn't exist.

## Schema

Migration `0033_assignment_fields.sql`:

```sql
alter table public.assignments
  add column if not exists instructions text not null default '',
  add column if not exists points numeric,
  add column if not exists canvas_assignment_id text,
  add column if not exists canvas_exported_at timestamptz;

alter table public.enrollments
  add column if not exists canvas_user_id text;
```

No RLS changes. The existing `assignments_select` / `assignments_write`
policies are table-scoped and already cover new columns; `enrollments`
likewise.

### Decisions inside that

**`instructions` is plain text, not HTML.** Storing HTML would mean
sanitizing on the way in and trusting it on the way out — an XSS surface on
a field a professor types into and students render. Canvas is no argument
either way here: a CSV upload cannot set an assignment description at all,
so instructions never travel to Canvas by this route. If a rich editor is
wanted later that is its own decision, with its own sanitizer.

**`instructions` complements the brief PDF, it does not replace it.**
`storage_path` stays exactly as it is. An assignment may have either, both,
or neither.

**`points` is nullable, breaking house style on purpose.** The rest of the
schema favours `not null default`. Here, null means "no point value set,"
which is genuinely different from "worth zero points" — a distinction the
speed-grader work will need, and one that a `default 0` would erase on every
assignment created before this migration.

**`points` is `numeric`, not an integer.** Confirmed against a real Clemson
gradebook export: scores of 3.50, 4.25, 4.50 and 9.50 appear in live data,
and one student's course score is 102.08 (extra credit puts scores above
the possible points).

**`points` stores a value and nothing more.** It does not feed cut points,
letters, or Bradley–Terry ranking. Wiring points into grading is the
speed-grader epic; doing it here would quietly change how existing
assignments grade.

**Canvas ids are `text`, not `bigint`.** Matches `courses.canvas_course_id`
from 0027. Canvas ids are opaque identifiers we never do arithmetic on.

**`canvas_user_id` is required by the CSV format, not merely prudent.**
Grades go into Canvas as an uploaded CSV, and Instructure's documented
required column order is: Student Name, **Student ID**, SIS User ID, SIS
Login ID, Section, then assignment columns. `Student ID` is the Canvas user
id, which we do not currently store — roster import matches on email. Email
is fine for *reading* a roster (a wrong match is visible and a professor
fixes it) and wrong for *writing* grades, where a changed campus address or
the Google-twin email collision already handled in 0027 would put a grade on
the wrong student's record.

**`canvas_exported_at` records that we generated a file, not that Canvas
received it.** The professor uploads the CSV by hand; we get no
confirmation. The name has to keep that honest — a column called
`canvas_pushed_at`, or UI copy reading "synced to Canvas," would assert
something we cannot know. "Last exported" is the true statement.

## Server actions — `src/server/actions/assignments.ts`

`createAssignment` gains optional `instructions` and `points`.
`updateAssignment` gains both in its patch.

Validation, in a new `src/lib/assignmentfields.ts` so it is testable without
a database (the pattern `seatmove.ts` and `rosterstage.ts` already follow):

- `instructions` — trimmed, capped at 5,000 characters.
- `points` — must parse to a finite number `>= 0`; anything else is
  rejected with a message rather than silently coerced. An empty input
  means null, not zero.

Neither field is state-gated. Unlike `deadline`, which is locked once
grading starts because it's baked into the analysis, instructions and points
can be corrected at any point in an assignment's lifecycle.

`createAssignment` currently drafts the default taste file from the brief
PDF only. It should also pass `instructions` to that draft, so a text-only
assignment still produces a drafted taste file instead of silently falling
back to a blank one.

## Canvas sync — `src/server/actions/canvas.ts`

`CanvasStudent` gains `canvasUserId: string`. The Canvas user object already
has `id`; the roster fetch simply discards it today. Populate it as
`String(u.id)` alongside name/email.

The sync has four separate enrollment write paths (twin merge, twin adopt,
fresh insert, and the reactivate/confirm loops). Rather than threading the
id through all four, stamp it in one idempotent pass over matched students
that writes `canvas_user_id` where it is null or has changed. Simpler, and
correct regardless of which branch created the row.

Nothing reads `canvas_user_id` yet. It backfills for free on every resync,
so by the time the grade export is built the data is already there.

## UI

A textarea (instructions) and a number input (points) in both
`AssignmentCreate.tsx` and `AssignmentEdit.tsx`, following the existing
`Label` + `Input` layout in those files. `AssignmentEdit`'s `save()` already
diffs each field against its initial value before including it in the patch;
these two follow the same shape.

## Tests

`src/lib/__tests__/assignmentfields.test.ts` — validation rules above,
including the empty-string-means-null case and rejection of negative,
non-numeric, and infinite points.

## Explicitly out of scope

**The grade export itself.** `canvas_assignment_id`, `canvas_exported_at`
and `canvas_user_id` sit unused until that feature is designed. What follows
is the research behind them, recorded so the next person doesn't redo it.

### Grade export — how it actually works

Grades reach Canvas as a **CSV the professor uploads through the Canvas
Gradebook's Import button**, not as an API write. ClassAct's job is to
produce a correctly formatted file and hand it to the professor as a
download. ([Instructure: How do I import grades in the Gradebook?][import])

[import]: https://community.instructure.com/en/kb/articles/660862-how-do-i-import-grades-in-the-gradebook

**This needs no Canvas API token at all.** Given that server-wide Canvas
credentials were deliberately removed and each professor now brings their
own token, an export path that works for a professor who has never connected
Canvas is worth a great deal. See the ingest note below for how such a
professor could still get the ids.

**Required column order** is fixed: Student Name, Student ID, SIS User ID,
SIS Login ID, Section, then one column per assignment. The SIS columns are
only required at SIS institutions — Clemson is one.

**Column headers carry assignment identity.** `Assignment 1a (individual)
(2338931)` — retain the parenthesized id to update an existing column. A
header with **no** id is treated as a new assignment: Canvas prompts for
points possible during import and creates it with Assignment Group
"Assignments", Submission Type "No submission", and a due date for Everyone.
It is auto-published and takes the course posting policy.

That last point resolves the attendance question. `Class_Attendance` and
`Excused Absence Documentation` are columns this instructor invented and
maintains by hand — Canvas has no attendance concept behind them — but a CSV
upload can *create* exactly that kind of no-submission points column. So
ClassAct can populate them whether or not they already exist. Worth asking a
second professor before treating it as the product-wide first feature,
though: it's evidence of one real weekly pain, not of a shared structure.

**Constraints the generator must respect:**

- **UTF-8**, or student and assignment names with special characters break.
- **Assignment titles may not contain** `Current Score`, `Current Points`,
  `Current Grade`, `Final Score`, `Final Points`, `Final Grade`,
  `Override Score`, `Override Grade`, or `Override Status`. Canvas silently
  refuses to recognise such a column. This needs validation at export time
  against ClassAct titles, with a clear message — a silently dropped column
  is the worst possible failure here.
- **Read-only columns are ignored on upload**, so don't emit them. Everything
  from `Assignments Current Score` rightward in a Canvas export is derived.
- **Reserved column names are ignored** for updates: Student, ID, SIS User
  ID, SIS Login ID, Section, Integration ID, Root Account. They still
  identify the row; they just can't be changed.
- **Multiple grading periods, if enabled, forbid creating assignments via
  CSV** entirely, and reject grade changes in a closed grading period. A
  professor in that configuration must create the column in Canvas by hand
  first. Detectable only by asking them, so the export UI should say it.
- **A CSV upload cannot set** assignment status, comments, or posting
  policy. Only scores.
- Suggested filename is `Grades-Course_Name.csv`.
- Complete/incomplete assignments: any full or partial credit uploads as
  complete, zero uploads as incomplete.

**Cross-listed shells are the normal case.** One real export spanned
sections `…-004-14619` and `…-005-18044`. The Section column must carry the
student's actual section, per `courses.canvas_section_ids`.

### The workflow being automated

This is what the instructor does by hand today, and the export feature
should be understood as automating exactly it:

1. Download the gradebook CSV from Canvas.
2. Delete every column not of interest — previous assignments, the
   read-only rollups.
3. Insert a column for the assignment being graded.
4. Upload. A column retained from the download **keeps its id in the
   header**, so Canvas updates it in place. A column that is genuinely new
   has no id, so Canvas prompts and creates it.

Two things follow that shape the design.

**Matching is by retained header id, not by name.** There is no name-based
fallback: the drop-down appears only for unrecognised columns. So a second
export that has forgotten the ids does not quietly update the right columns
— at best it re-prompts, at worst it duplicates them. `canvas_assignment_id`
is therefore not what makes export work; it is what makes *re-export* work,
which is the case that recurs every week.

**Deleting columns is safe, so the export should be narrow.** Absent columns
are simply not touched. ClassAct should emit the identity columns plus only
the assignment(s) being exported — never a reconstruction of the whole
gradebook. That is both less to build and less to get wrong.

### The first export is free

Because Canvas builds a column from any header it doesn't recognise, the
*first* export of a brand-new assignment requires no Canvas knowledge at all
— no token, no ingest, no id. A professor who has never connected Canvas
downloads a file from ClassAct, uploads it, and Canvas creates the column.
That is the day-one story and it is a good one. It is only the second export
of the *same* assignment that needs the id.

### Ingesting a Canvas export to learn ids

Let the professor **upload their Canvas gradebook CSV into ClassAct**. This
replaces steps 1–3 of the manual workflow with one upload and one download,
and it is where every id comes from — no API token, no copy-pasting.

One such file supplies everything the export needs:

| From the file | Supplies |
| --- | --- |
| Header row | Canvas assignment id per column → `canvas_assignment_id` |
| `ID` column | Canvas user id per student → `canvas_user_id` |
| `SIS User ID` column | The C-number. Not stored anywhere in ClassAct today. |
| `SIS Login ID` column | Campus email — already have it as `roster_email` |
| `Section` column | The student's section name. Not stored today; a cross-listed shell puts students in different sections, so it can't be derived from the course. |

The last two rows are a real gap: Instructure lists Student Name, Student
ID, SIS User ID, SIS Login ID and Section as the required columns, and
ClassAct can produce only two of the five. It is unverified whether Canvas
tolerates blank SIS and Section values, since both are reserved columns it
ignores for updates and matching goes through `ID`. **Test that against a
live course before building** — if blanks are tolerated, `canvas_user_id`
alone is enough; if not, ingest must also persist the C-number and section
name, and export cannot work at all until a professor has ingested once.

They are deliberately **not** in migration 0033. Unlike `canvas_user_id` —
which the API sync can capture for free today, since the roster fetch
already reads the Canvas user object — the section *name* isn't available
from the sync (it reads `course_section_id`, a number, not the
`S2601-MKT-4310-004-14619` string the gradebook uses), and the C-number
isn't fetched at all. They belong to the ingest feature that would populate
them, and should be added with it.

An ingested gradebook is FERPA-covered student data arriving over HTTP, and
needs the same care as the roster import — plus a decision about whether the
*grades* in it are stored at all. They aren't needed for the export, so the
default should be to read identity, discard scores.

## Naming hazard

`assignments.published_at` in ClassAct means **grades are released to
students**. Canvas's `published` means **students can see the assignment
exists**. Opposite meanings, same word. Any Canvas publish state must be
named something else.

## Handling the export

The gradebook CSV that informed this plan contains 76 students' names,
SIS C-numbers, campus emails and grades — FERPA-covered. It must not enter
the repo. Add a `*Grades-*.csv` ignore rule before this work starts; a
`git add -A` in a tree this actively edited would otherwise commit it.
