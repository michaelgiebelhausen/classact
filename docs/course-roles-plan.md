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

**An observer's activity in this course contributes nothing to their My
Metrics. Full stop.**

Worth flagging because this is *not* what Observer means in Canvas. There, an
observer is usually a parent or advisor watching a particular student. Here it
is someone sitting in on the class themselves — a visiting colleague, an
auditor.

**Why the rule exists.** My Metrics is not a usage report. In Mike's words it
is "sort of a reflection of your character as a member of the classroom
community" — it reads shows-up-regularly, on-time, networks with people,
answers questions, turns work in, and reports them back as Dependability,
Initiative, Collaboration, Coachability. It makes a claim about who you are.

An observer's attendance is erratic and their participation partial. For an
observer **that is the role working correctly, not a character defect.** Score
them on student expectations and the metric doesn't merely read low — it says
something false about the person. That is the harm the rule prevents, and
excluding the course entirely prevents it completely.

**The observer's tab stays visible, and says why.** Not a blank screen and not
a hidden nav item — a plain line: *"You're observing this class — nothing here
counts toward your record."* An observer is likely wondering exactly that, and
this is now always the answer.

**One-way: observers count for students, never for themselves.** An observer is
a real body in the room. They appear on the seat map and in the name games, and
a student who meets them or verifies them as a neighbour gets full credit for
it — from the student's side they met a person, which is true. The exclusion
runs in one direction only. (This also settles what used to be an open
question here: yes, observers appear on the roster and seat map.)

**The pattern already exists in the codebase.** `saveNameGameScore`
(`src/server/actions/games.ts:36`) does exactly this today: someone with no
active enrollment can play the name games, and the score simply isn't
recorded — *"Professor or observer: let them play, just don't score it."*
Participate freely, nothing recorded about you. That is the observer rule in
miniature, and it's the idiom to follow.

**But note where it would need changing.** It keys on *absence of an active
enrollment*. An observer under a `course_staff` model may well hold an
enrollment row, at which point this check would start scoring them. Any
implementation has to sweep for "no enrollment ⇒ don't record" checks like
this one and make them role-aware, not just add an exclusion filter to the
employability aggregation.

**Considered and rejected — don't re-derive it.** An earlier draft of this note
built something more elaborate: count an observer's numerators but not the
course's denominators, so a committed observer could still earn a portrait,
gated behind an activity threshold so the modal observer got no portrait at
all rather than a faint one. It works, and it was dropped on purpose.

Mike, 2026-08-28: *"I would rather have a system that works for the people who
are actually students than to design something around the one or two outliers
(less than 1% of the users who are observers who actually contribute)."*

**What that costs, stated plainly so it doesn't look like an oversight:** the
committed observer who attends most classes and does the assignments earns
nothing for it. That is real, and it is under 1% of observers, who are
themselves a small minority. The price buys a rule that is one sentence long,
has no threshold to tune, and cannot be got subtly wrong — which the ratchet
very much could. If observers ever stop being rare, revisit; until then this
is the right trade.

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
- Employability aggregation gains a course-exclusion filter for observers:
  their rows in this course simply don't feed their own work-readiness signals.
  It stays one-way — their presence still counts toward the *students'*
  metrics, seat map and name games.

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
3. Can a second professor delete the course, or remove the first professor?
