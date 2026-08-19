# Self-Reported Absences — Sprint Plan

**Status:** Designed 2026-08-19 from Mike's brief; building same day.
Goal: students report absences to ClassAct instead of emailing the professor;
AI applies the professor's attendance policy and gives an immediate
excused / unexcused answer; the professor only sees appeals. No documentation
is ever stored — only a legitimacy assessment of it.

## The pain, restated

Two kinds of email the professor doesn't want:

1. **Planned, in advance** — athletics travel, job interview, university trip,
   wedding, religious observance. Usually legitimate; the professor just has
   to read it, decide, reply, and remember.
2. **Unplanned, shortly before** — "not feeling well." Unverifiable, and the
   professor has to decide case by case whether to ask for a note.

Both come down to *apply my policy and tell the student*. That's mechanical,
and the app already knows the schedule, the roster, and who actually showed up.

## Decisions

1. **Policy lives on the course** (`courses.attendance_policy` jsonb, one
   column, no new table). A Setup tab "Attendance" holds: free-text policy
   (what the syllabus says), which categories count as excused, how many
   hours' notice is expected, which categories need documentation, and how
   many unexcused absences are free before it matters. Sensible defaults so
   a professor who never opens the tab still gets reasonable verdicts.
2. **AI is the judge; the professor is the court of appeal.** The student's
   submission goes to the model with the policy attached and comes back with
   a verdict, a 0–100 legitimacy score, a one-line neutral summary, and a
   student-facing reason. The verdict is final *unless* the student appeals;
   an appeal lands in the professor's queue with one-click uphold/override.
   One deterministic safety net runs before the model: if the policy says
   this category needs documentation and none was attached, it's unexcused
   (that's a policy fact, not a judgment call).
3. **Documents are assessed, never stored.** The upload (image or PDF) goes
   from the browser to the server action to OpenRouter as a base64 content
   part — the same `image_url` / `file` parts roomvision.ts and tastyai.ts
   already send — and is discarded. What persists: `has_documentation`,
   the document *kind* the model recognised ("clinic visit summary",
   "team travel letter", "event ticket" — type only, never contents), and a
   0–100 authenticity score. No health details, no names from the document.
4. **Platform pays for this AI.** New `AiTask` "absence" joins
   `PLATFORM_SUBSIDIZED`, consistent with Mike's rule: he pays for non-grading
   AI, grading stays BYOK. Each assessment is a few hundred tokens; the
   default model (`anthropic/claude-sonnet-5`) handles images. Professors
   with their own key use it automatically via `resolveCourseAi`.
5. **Cross-course check, both directions, no naming.** When a student checks
   into course B on date D, any absence they reported in another ClassAct
   course for D is flagged `attended_elsewhere`. When a student *submits* an
   absence for D having already checked in elsewhere that day, same flag.
   The professor sees "checked into another ClassAct class that day" —
   not which class. Needs the admin client (RLS scopes check-ins per course).
6. **Advance notice is computed, not claimed.** `advance_hours` = meeting
   start on the absence date (course timezone) minus `submitted_at`.
   Negative means after class started. Needs two new pure-Intl schedule
   helpers (no date library in the project): `meetingStartInstant` and
   `upcomingMeetingDates` (the date picker defaults to the next class).
7. **Students see the verdict and why, not the numbers.** Scores are for the
   professor; showing them to students invites gaming the explanation.
8. **All writes go through server actions with the service-role client.**
   RLS on `absences` is select-only (professor of the course, or the
   student's own rows) plus professor full control. A browser client can
   insert nothing and cannot PATCH `ai_verdict` or `final_verdict` — the
   same lesson as the billing-columns trigger (0024), applied up front.
9. **Where it lives.** Check-in page, under the map, for both roles —
   students: "Can't make a class?" card → form; professors: "Scheduled
   absences" table (date · student · category/summary · notice · docs +
   authenticity · verdict · flags · appeal actions), term to date. My Metrics
   gains absences (reported / excused / unexcused) on the student page and
   an Absences column on the professor's per-student table. Copying a course
   carries the policy across.

## Data model (migration 0025)

```
courses:   + attendance_policy jsonb not null default '{}'
           { text, excusedCategories[], advanceNoticeHours, docsRequiredFor[],
             freeUnexcused }  -- parsed leniently with defaults

absences:  id, course_id, enrollment_id, absence_date date,
           category text  (athletics|interview|university_event|religious|
                           family|illness|bereavement|other),
           explanation text, submitted_at, advance_hours numeric,
           has_documentation bool, documentation_kind text|null,
           ai_summary text, ai_reason text, ai_legitimacy int,
           ai_doc_authenticity int|null, ai_verdict text (excused|unexcused),
           ai_flags text[],
           appeal_note text|null, appealed_at,
           professor_verdict text|null, professor_note text|null, decided_at,
           attended_elsewhere bool default false,
           unique (enrollment_id, absence_date)
           -- final verdict = professor_verdict ?? ai_verdict
RLS: absences_select (is_course_professor(course_id) or owns_enrollment);
     absences_professor_all. No student write policies.
```

## AI contract (server/absenceai.ts)

Input: policy (text + knobs), category, explanation, advance hours, meeting
context (course name, date, time), optional document part, optional flag
"already checked into another class today".
Output JSON (prompt-instructed, fence-stripped, hand-validated, clamped):
`{ verdict, legitimacy 0–100, summary ≤140 chars, reason 1–2 sentences for
the student, docKind|null, docAuthenticity 0–100|null, flags[] }`.
Flags the model may raise: `vague`, `contradicts_policy`, `late_notice`,
`doc_mismatch`, `doc_looks_edited`, `repeat_pattern` (we pass the count of
the student's prior absences this term).

## Sprint tasks

1. **Migration 0025 + db.ts types** — courses.attendance_policy, absences
   table, RLS, realtime not needed.
2. **lib/absences.ts + tests** — category catalog, policy parse/defaults,
   `noticeLabel(hours)`, verdict/score validators, `finalVerdict()`.
3. **lib/schedule.ts + tests** — `meetingStartInstant(schedule, date)`,
   `upcomingMeetingDates(schedule, now, limit)`, pure Intl, DST-safe.
4. **server/absenceai.ts** — prompt, call (image/PDF parts), parse, clamp;
   aicreds gains "absence" task (subsidized).
5. **actions/absences.ts** — `submitAbsence` (validate, cap upload 6MB,
   compute notice, AI, safety net, cross-course check, insert via admin),
   `appealAbsence`, `decideAbsence`, `listCourseAbsences`,
   `listMyAbsences`; checkin.ts hook after a successful check-in.
6. **Setup → Attendance tab** — policy editor, `updateAttendancePolicy`
   action; setup page select + prop; duplicateCourse copies the column.
7. **Check-in page** — student `ReportAbsence` card (date picker defaulting
   to next class, category, explanation, optional document, immediate
   verdict + appeal); professor `ScheduledAbsences` table with appeal
   actions.
8. **Metrics** — student absences summary; professor per-student Absences.
9. **Appeal email** — best-effort Resend to the professor (feedback pattern).
10. **Adversarial review workflow** on the whole change, fix what's confirmed.

Mike runs 0025 in the Supabase SQL editor; nothing else to configure —
no new env vars.
