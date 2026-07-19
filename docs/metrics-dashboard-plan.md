# My Metrics Dashboard v2 — Plan

**Status:** Proposed 2026-07-19 (audit complete; two open questions for Mike).
**Principle carried forward:** the dashboard is a growth mirror, not a ranking
(employability.ts comment) — every statistic is framed as feedback the student
can act on, and students only ever see their own numbers.

## What the audit found

Today's student view: 9 attendance/networking/games tiles + 6 work-readiness
competencies + per-project contribution. The richest signals are **collected
but never surfaced**:

- `focus_events` (away/back during lectures) — summarized in lib/focus.ts,
  shown live to the professor only.
- The whole Assignments stack: `ai_scores.own_bar/distinctiveness`,
  `comparisons` (verdict/pair_type → tastestats), `rubric_views.seconds`,
  `taste_files` (default-diff + edit timing), `submissions.last_edit_at` vs
  deadline, `rankings`.
- `poll_rounds`/`summarizeParticipation.firstCorrect` — computed, dropped.
- `exercise_responses.updated_by_enrollment_id` — who actually wrote the
  group's answer.
- Self-assignment *patterns* in team_tasks (size/type of what students give
  themselves).
- Shout-outs: pure greenfield (nav stub only).

## The five statistic families (Mike's framing → concrete stats)

### 1. Active learning
- **Answered rounds** (exists), **first-vote accuracy** (`firstCorrect` —
  currently dropped), and the star: **changed-to-correct** ("updates their
  mind when a peer has it right" — already feeds Coachability, gets surfaced
  as its own stat).
- **Group-answer authorship**: count of exercise responses the student
  actually wrote/edited (`updated_by_enrollment_id`) vs groups joined —
  "carries the pen" signal.

### 2. Staying on task (Focus)
- From focus_events per lecture: **on-task rate** (1 − away time / lecture
  time attended, via summarizeFocus), **drift count/returns**. New
  **"Focus" competency**: framed as growth ("stayed with the room 92% of
  lecture time"), never as surveillance language.

### 3. Teamwork & leadership
- Existing: done minutes, share, distributed, flags, lead roles, contracts.
- New: **self-assignment profile** — share of tasks self-assigned, median
  size of self-assigned vs received tasks ("takes the big rocks or the
  crumbs?"), and lead-role count surfaced explicitly.

### 4. Shout-outs (new feature, v1)
- `shout_outs` table: id, course_id, giver_enrollment_id,
  recipient_enrollment_id, context ('exercise' | 'project' | 'peer_review'),
  context_id, message (short), created_at + RLS (giver writes; recipient
  reads own; professor reads all).
- **Giving surfaces (v1):**
  1. **Peer grading** — after judging a pair, one tap: "This deserves a
     shout-out." Work is anonymous at praise time; recipient learns of it
     only after publish. Because praise precedes the settled ranking, it is
     a *bet* — which powers the stat Mike asked for:
  2. **Project team board** — shout out a teammate on any done task.
  3. **After exercises** — quick "shout out someone from your group."
- **Stats:** shout-outs received; shout-outs given (generosity);
  **"Spots excellence"** — the reward-for-calling-out-good-work stat: share
  of peer-review shout-outs that went to work finishing in the top quartile
  of the settled ranking.
- Nav "Shout-outs" goes live → a simple page: give + received feed.

### 5. Assignments (taste & judgment)
- **Holds a high standard:** taste-file engagement (edited vs default,
  criteria depth, days-before-deadline of first edit) + **met own bar**
  (`ai_scores.own_bar` averaged).
- **Recognizes good work:** taste-agreement averaged across published
  assignments; **self-honesty**; **peer-grading participation**;
  **rubric study time**.
- **Distinctiveness** (avg) and **timeliness** (median hours before
  deadline of last edit) as their own tiles.

## Work-readiness: 6 → 8 competencies

New: **Focus** (on-task rate, lectures followed) and **Taste & judgment**
(taste-agreement, self-honesty, high-standard, distinctiveness). Enriched:
Coachability + firstCorrect; Initiative + early taste-file starts + shout-outs
given; Collaboration + shout-outs received + group-answer authorship;
Dependability + submission timeliness + peer-grading participation.
All formula changes stay in pure `employability.ts` with updated tests.

## Dashboard layout (student)

1. Work-readiness card (8 competencies) — stays on top.
2. **In class:** attendance tiles + focus stats.
3. **Active learning:** answered / first-vote / changed-to-correct /
   carries-the-pen.
4. **Teamwork:** existing project cards + self-assignment profile.
5. **Taste & judgment:** the assignment stats.
6. **Shout-outs:** received (with messages), given, spots-excellence.

Professor view: unchanged for now except the existing per-student table
(pending Q2 below). Work-readiness remains student-only.

## Build phases

1. **Signal aggregation** — new queries in metrics.ts (focus, assignments,
   exercises-authorship, self-assignment profile) + extended
   WorkReadinessInput + 2 new competencies + tests. No UI change yet.
2. **Shout-outs v1** — migration 0014, actions, the three giving surfaces,
   shout-outs page, nav live, spots-excellence stat.
3. **Dashboard UI** — reorganize metrics page into the six sections.
4. **Docs/runbook** — HANDOFF migration list, roadmap addendum.

## Decisions (Mike, 2026-07-19)

1. **Shout-out visibility:** private to recipient + professor sees all;
   giver identity shown on project/exercise shout-outs, anonymous on
   peer-review ones. Public feed deferred.
2. **Professor side — the Participation Cockpit** (not table columns):
   mirrors the assignment grading interface, where "the assignment is the
   person's scores."
   - **Avatar histogram** of a weighted **participation score** = weighted
     average of the 8 competency scores (0–100).
   - **Weight sliders** per competency (persisted per course in
     `courses.participation_weights`).
   - **Conjoint weight inference:** professor compares two students side by
     side (attribute chips, same 5-position slider as assignment pairs);
     comparisons are stored (`participation_comparisons`) and a logistic
     fit over attribute differences infers the weights ("which attributes
     actually drive your judgment") — professor can apply or ignore the
     fitted weights.
   - **Click a student** → competency breakdown panel.
   - **Flag** a student for suspected gaming / maladaptive behavior
     (`student_flags`, professor-private).
   - Work-readiness scores thereby become professor-visible in aggregate —
     an intentional revision of the earlier student-only stance.
