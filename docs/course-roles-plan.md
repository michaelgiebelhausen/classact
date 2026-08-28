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
auditor — who participates like a student but under different expectations.

**Why this matters more than it looks.** My Metrics is not a usage report. In
Mike's words it is "sort of a reflection of your character as a member of the
classroom community" — it reads shows-up-regularly, on-time, networks with
people, answers questions, turns work in, and reports them back as
Dependability, Initiative, Collaboration, Coachability. It makes a claim about
who you are.

An observer's attendance is erratic and their participation partial. For an
observer **that is the role working correctly, not a character defect.** Score
them on student expectations and the metric doesn't just read low — it says
something false about the person. That is the harm to avoid.

**So the rule is asymmetric, and this is the part to get right.** Mike's words
are "shouldn't *negatively* impact" — not "shouldn't count". Those differ:

- What an observer **does** do is real evidence of character and should count
  for them. If they show up and network and answer questions, that happened.
- What they **don't** do must not count against them.

That rules out the obvious implementation. Excluding the course wholesale from
their aggregation is wrong in the generous direction — it throws away the good
along with the bad, and an observer who engages well ends up with nothing to
show for it.

**Mechanically it is the denominators.** The scores are ratios over what the
course expected of you:

```
attendanceRate = sessionsAttended / sessionsHeld        // employability.ts:140
verifiedRate   = verifiedAttendances / sessionsAttended // :142
```

`sessionsHeld` is "every class this course ran", which is the right
expectation for an enrolled student and the wrong one for an observer. Same
shape for `peerPairsAssigned` vs `peerPairsDone`, and for assignments. **Count
an observer's numerators; don't hold them to the course's denominators.**
Non-participation should read as "no signal here", which the code already
models — `hasSignal` and the `null`-able means exist precisely for
"nothing to read yet" — rather than as a zero, which reads as a failing.

**The real distribution, from Mike (2026-08-28).** This is what the design has
to fit, and the two ends pull in opposite directions:

- **The modal observer** has some interest in the course, shows up once or
  twice, and disappears. This is the common case, and it must not be punished.
- **The committed observer** comes to most classes and does the assignments.
  Mike has had these. That effort should be rewarded.

**So the mechanism is a ratchet: the floor is silence, the ceiling is open.**
Activity can only ever add. Absence is never evidence against them.

That resolves a trap in the numerators-only rule as I first wrote it. Strip the
denominators and the modal observer still lands at a low raw count — which
`levelFor()` renders as **"getting started"**, a displayed level, and still a
mild claim about their character. For someone who attended twice and left,
that claim is not true; they didn't start anything and weren't trying to.

The correct output for the modal observer is **no portrait at all**, not a
faint one. The code already has the concept: `hasSignal: false` means "there's
essentially no activity to read yet." An observer's metrics should stay behind
that gate until their own activity clears a threshold — and then be built
from what they actually did.

Practically:

- **Below the threshold — no metrics, and say why.** Not an empty state that
  reads as failure. Something honest and non-judgmental: *you're observing
  this class; nothing here is counting toward your record.* That is genuinely
  useful information to an observer, who may well be wondering.
- **Above it — a real portrait**, earned, from numerators only.

The threshold itself is a tuning question for whenever this is built, not a
decision to make now.

**Consequence to write down before someone trips on it:** observer metrics are
therefore not comparable to student metrics, because they are measured against
a different set of expectations. Never rank them together, and never put an
observer in a class-wide comparison or leaderboard.

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
- Employability aggregation learns *role-aware denominators* for observers —
  count their numerators, don't hold them to the course's expectations. Not a
  course-exclusion filter; see the Observer section for why that's the wrong
  shape.

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
