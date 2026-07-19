# Tasty Grading — Design Spec

**Status:** Designed (grill-me session 2026-07-19, all decisions Mike-approved). Not yet built.
**Landing eyebrow:** AI/Peer/Instructor Grading · **Feature name:** Tasty Grading

## Concept

Students co-create the standard for every assignment, hold their own work to it,
and learn to recognize excellence by judging real work. AI drafts the rankings;
peers and the professor refine them. Grading — the biggest professor pain —
becomes a class-wide exercise in taste.

## Non-negotiable principles

1. **Zero required professor input to function.** The system runs a full cycle
   (taste files → emergent rubric → AI scores → peer refinement → student
   reports) with no professor action. Professor rubric/taste file are optional
   seeds, never prerequisites.
2. **"No grade is published without professor review."** The one mandatory
   professor act: glance at the ranking, optionally drag cut points, click
   **Publish**. Letters never appear before that click.
3. **Never an accusation.** No "AI detection," no cheating language. We measure
   *convergence/distinctiveness* and show it; humans judge.
4. **Left → right = low → high** everywhere (sliders, histograms).
5. **FERPA:** a student sees their own rank/grade/stats only. The histogram and
   anyone else's standing are professor-only.
6. Separate from Projects: Projects = team task management; Assignments =
   individual submission + grading. A project deliverable *can* be submitted as
   an assignment.

## The taste file

- Every assignment has, per student, a live **taste file**: structured criteria
  (name + 1–3 sentence "what excellent looks like") plus a freeform "my bar"
  statement. No fixed count — structure is writing scaffolding, not a cap.
- AI generates the **default taste file** from the assignment PDF when the
  assignment is published; the student edits/rewrites/adds from day one.
- **One deadline** for submission (PDF, ≤ ~20 MB, one file) + taste file; both
  lock together. Edit history is timestamped.
- Taste-file quality (comprehensive, sophisticated, high standard, distance
  from the AI default) feeds the **"holds themselves to a high standard"**
  statistic — not the assignment score directly.
- **Timeliness stat** keys on the *last edit* before deadline (prevents
  submit-early-then-edit gaming).
- Submission page instructs: *don't put your name in the file* (v1 anonymity
  is honest-effort; we can't strip names inside PDFs).

## Lifecycle

`published → deadline (lock) → AI analysis (~minutes) → peer window →
professor fine-tune → Publish → student reports`

- Peer window: course-level default (professor-settable, real datetime picker —
  e.g. "midnight Sunday"), per-assignment override, auto-closes.
- Professor can jump in and compare pairs at any time during the peer window.

## Analysis engine (at deadline)

1. **Rubric emergence — grounded theory / psychometrics.** Themes emerge across
   all locked taste files; themes = constructs, students' actual sentences =
   the items evidencing each theme. Professor rubric/taste file, when present,
   act as seed themes that always survive; themes carry provenance
   (professor-set / class-emergent / both).
2. **Per-submission AI scoring (absolute, one pass each):** score per theme
   (anchored to the theme's quote-items, with an evidence quote pulled from the
   submission), an overall score, and **"met their own bar"** vs the student's
   personal taste file. Per-theme scores are the conjoint attribute data.
3. **Distinctiveness (convergence, not detection):**
   - System generates ~3 "lazy one-shot" baseline answers to the assignment;
     the grader scores distance-from-generic.
   - Pure-code shingling near-duplicate check across submissions; unusually
     similar *pairs* surface privately to the professor ("look at these two").
   - Student-facing scale: **Distinctive ↔ Generic** ("sloppy/generic," a nod
     to AI slop; never "cheating").
   - Professor dial sets distinctiveness's *weight* in the ranking (0 =
     informational only; default moderate). Always computed, always shown.
4. **Draft ranking** = overall scores as the Bradley–Terry prior.
5. Built as **resumable batches** (100 students × PDF calls must survive
   serverless timeouts). Uses existing OpenRouter integration.

## Human comparisons (peers + professor)

- **UI:** two submissions side by side (pdfjs renders), one horizontal
  5-position slider: *clearly worse / slightly worse / equal / slightly better
  / clearly better* (left→right). Equal is submittable. "Slightly" = 1 win,
  "clearly" = double-weight in the Bradley–Terry update.
- **Professor vote weight:** editable setting, default 8× a peer vote (1× =
  "just another community member").
- **Pair serving:** default = uncertainty sampling (max information per click),
  **weighted toward pairs straddling grade cut points** once markers are set.
  Clicking a histogram bar serves a random within-bar pair.

## Peer grading

- Opens when analysis completes. **Mandatory first stop: the emergent consensus
  rubric** (themes + anonymous classmate quotes). Time spent reviewing it is
  tracked as a statistic.
- Default **three pairs** per student, professor-adjustable mix (0–4 total) of
  three types:
  1. **Exceptional probe** — one AI-judged excellent submission vs ordinary
     (shows what great looks like; calibration check).
  2. **Self vs other** — disclosed up front: "one of these is yours; you'll be
     scored on how honestly you place it" → **self-honesty / objectivity**
     statistic.
  3. **Near-tie refinement** — two adjacent-ranked submissions (moves the
     needle most).
- Pair order randomized (exceptional not always in the same slot); students can
  revisit their pairs before final submit.
- Double-blind; no teammates, no reciprocal pairs. Students see no ranks,
  scores, or histogram during judging.
- **Peer votes move classmates' rankings** (via BT). The honesty engine:
  every vote is also a bet — comparisons are scored against the settled
  final ranking → **"recognizes good work" (taste-agreement)** statistic.
  Participation itself is a stat (feeds work-readiness dependability).

## Professor cockpit

- **Avatar histogram**: bars are stacked circles with student photos;
  adjustable bin count; not necessarily normal.
- **Draggable triangular cut-point markers** along the axis (A/A−/B+…);
  course-level default cut points supported.
- Stability meter ("top/bottom stable; 12–19 churning"). No comparison quota.
- **Pre-publish checkpoint**: "Adjust cut points? Review more pairs?" →
  **Publish the scores.** Publishing is the professor's irreducible act.
- Settings panel: vote weight, distinctiveness dial, pair mix, peer window
  default/override, cut-point defaults.

## Reveal schedule

1. **Peer window opens:** consensus rubric visible to all (no ranks).
2. **On publish:** full private report — rank ("26 of 34"), letter, per-theme
   scores with evidence quotes, met-own-bar, distinctiveness, judging stats
   (taste-agreement, self-honesty, participation, time-on-rubric, timeliness).
3. **Ongoing:** durable stats accumulate on My Metrics beside work-readiness
   competencies.

## Data model sketch

```
assignments:   id, course_id, title, storage_path, deadline, peer_close_at,
               settings jsonb (pair mix, weights, dial), state, created_at
taste_files:   id, assignment_id, enrollment_id (null = professor's),
               criteria jsonb, bar_statement, is_default_untouched,
               first_edit_at, last_edit_at
submissions:   id, assignment_id, enrollment_id, storage_path, note,
               submitted_at, last_edit_at
rubric_themes: id, assignment_id, name, description, provenance, items jsonb
               (quotes + source enrollment ids)
ai_scores:     id, submission_id, theme_id?, score, evidence_quote,
               overall, own_bar_score, distinctiveness
comparisons:   id, assignment_id, judge_enrollment_id (null = professor),
               left_submission_id, right_submission_id, verdict (-2..+2),
               pair_type, decided_at
rankings:      id, assignment_id, submission_id, bt_score, rank, letter,
               published_at
cut_points:    on assignment settings (or course defaults on courses)
```

## Landing page (ship with Phase 5)

Marquee placement after Group Projects. Eyebrow **AI/PEER/INSTRUCTOR GRADING**,
title **Tasty Grading**. Pitch (approved draft): grading is the loneliest,
slowest work in teaching; students define the standard, hold their work to it,
and learn to recognize excellence by judging real work side by side; AI drafts
the rankings, students and professor refine; "the click that publishes every
grade is yours"; vending-machine work is visible to the whole room. Dual-benefit
row: "Grading a mountain of submissions" → "Students learn what excellent work
looks like — and hold themselves to it."

## Build phases

1. **Assignments core** — tables, professor create (PDF + deadline, all else
   defaulted), AI default taste file, student submission page (PDF + taste
   editor + timestamps), deadline lock, course-nav entry.
2. **Analysis engine** — rubric emergence, per-theme scoring + own-bar +
   distinctiveness + baselines + shingling, draft ranking; resumable batches.
3. **Peer grading** — pair assignment (3 types), rubric-first flow with time
   tracking, comparison UI + slider, BT updates, agreement/self-honesty stats.
4. **Professor cockpit** — avatar histogram, bins, cut-point triangles,
   boundary-weighted next-pair, stability meter, settings, publish flow.
5. **Student report + metrics + landing** — full report, My Metrics /
   work-readiness integration, homepage section.

## Known edges (accepted for v1)

- PDF name anonymity is honest-effort (instruction, not stripping).
- If AI absolute scores compress mid-pack, add targeted AI pairwise among
  near-ties in v2 (not a full tournament).
- Collusion in peer voting is bounded by: assigned (not chosen) pairs, no
  reciprocals, professor weight, and taste-agreement scoring — monitor in pilot.
- Conjoint analysis over per-theme scores vs pairwise outcomes ("which
  attributes actually drive taste") is a v2 analytics feature; the data model
  captures everything it needs from day one.
