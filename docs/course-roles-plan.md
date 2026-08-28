# Course roles — deferred design note

**Status: NOT BUILT. Deferred by Mike on 2026-08-28** — "I don't know that we
need to go down this road at this time, when the system is so unstable
already." This file exists so the thinking isn't lost, not as a work item.
Don't start building from it without asking.

## Where things stand today

There is exactly one course role and it is derived, not declared: you are the
professor of a course iff `courses.professor_id` is you, and a student of one
iff you hold a non-dropped `enrollments` row. Both can be true of the same
person in different courses. Nothing is stored on the account — see
`src/lib/membership.ts` and migration `0035_membership_is_the_role.sql` for why
the old global `profiles.role` was removed from service.

**The live gap this leaves.** Kevin Flynn co-teaches *AI Tools and Techniques*
with Mike but cannot see it, because he is not its `professor_id`. He signed up
on 2026-08-15, created two empty courses of his own forty minutes later
(`MKT 4500 008` / `009` — still there, legitimate, **do not delete**), and has
not been back. The gap is real and has already cost one colleague.

**Do not work around it by having a co-teacher join with the student code.**
That puts them on the roster as a student — attendance, seat map, name games,
participation metrics — and untangling it later is worse than waiting.

## The roles, as specified by Mike (2026-08-28)

These are his words, expanded only where the mechanism follows from them.

### Professor

**Access to everything.** No carve-outs. A second professor on a course is
indistinguishable from the first — same roster, same grading, same metrics,
same setup. This is the co-teaching case (Mike + Kevin) and it is the only one
of the three with a named person waiting on it.

### TA / Grader

**Grading, and not student metrics.**

Grading means assignments, submissions, the grading cockpit, rubrics, and
returning marks. Student metrics means the professor's participation cockpit —
attendance tallies, absence verdicts, project stats, the participation and
work-readiness views at `/course/[courseId]/metrics`.

Note the line is *not* "can't see student performance" — grading is student
performance, and a grader obviously sees it. The line is the **behavioural**
record: who showed up, who spoke, who sat where, who is drifting. A grader
marks work; they are not handed a dossier on the person who submitted it.

### Observer

**Their reputation metrics are not impacted by the class.**

Worth flagging because this is *not* what Observer means in Canvas. There, an
observer is usually a parent or advisor watching a particular student. Here it
is someone sitting in on the class themselves — a visiting colleague, an
auditor — who participates like a student but whose participation shouldn't
count toward their own record.

That makes it a **data-scoping rule, not a UI rule.** "Reputation metrics" is
the student-facing work-readiness view (`src/lib/employability.ts`) — the
growth mirror built from attendance, seats claimed, people met, think-pair-share
and so on. An observer's activity in this class must be *excluded from the
aggregation that feeds their own* work-readiness signals, rather than merely
hidden from a page. Hiding it would leave the number quietly wrong.

Open sub-question: does an observer still appear on the professor's roster and
seat map? Probably yes — they're physically in the room and the seat map is a
spatial tool — but that hasn't been decided.

### Not specified

Mike could not think of other roles that occur commonly, and neither could I in
a way that earns its keep. Canvas's fuller taxonomy exists because Canvas is a
system of record for an entire university; ClassAct has one course with one
co-teacher. Don't import the taxonomy wholesale.

## Shape when it is built

Roles are relationships now, so this extends by adding rows rather than by
re-labelling accounts:

- A `course_staff` table: `course_id`, `profile_id`, `role`
  (`professor` | `ta` | `observer`), plus RLS.
- The professor check becomes "owns this course **or** is staff on it with a
  sufficient role" — roughly twenty call sites currently comparing
  `professor_id` directly, plus the course-scoped `requireProfessor(courseId)`
  helpers in `exercises.ts`, `lectures.ts`, `participation.ts` and friends.
- Employability aggregation gains a course-exclusion filter for observers.

**No account, course, or enrollment migrates. Nobody re-picks anything.** That
is the whole benefit of having removed the global flag first, and it is why
deferring this costs nothing: none of the above gets harder by waiting.

Rough size: a focused day, most of it the call-site sweep and its tests.

## Decide before building

A product question, not a technical one, and Mike's call:

1. Does a co-teacher need to be *added* by the owner, or can they self-join
   with a staff code? (Self-join re-opens the "anyone can claim authority"
   problem that 0035 just closed — lean toward invitation.)
2. Can a TA see the roster and contact details, or only submissions?
3. Does an observer show on the roster and seat map?
4. Can a second professor delete the course, or remove the first professor?
