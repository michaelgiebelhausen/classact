# Attendance recovery and excluded dates

Local implementation, October 29, 2026. Apply `supabase/migrations/0055_attendance_recovery.sql` before deploying this code. No production migration, attendance write, email, or deployment was performed during this work.

## Student flow

Students select a past session and seat in **Check in → Forgot to check in?**. The existing neighbor request remains the primary action. If no eligible recorded immediate neighbor exists, **No one nearby checked in?** exposes an explicit attendance pledge. The server independently checks eligibility, enrollment, date, seat occupancy, attendance exclusions, and absence reports.

The pledge immediately creates verified attendance without networking credit or instructor approval. Its exact text and timestamp are stored with the student, session, and seat. A student who signed this personal pledge may witness an adjacent student's late request for that same session. Peer-confirmed late claims do not themselves become witnesses.

> I attended this class on this date and sat in this seat. I understand that knowingly submitting false information violates the university’s academic integrity expectations and could subject me to university academic integrity proceedings.

Every positive late witness response requires a separate unchecked affirmation that the witness personally saw the classmate. The stored statement uses the same university academic integrity language. Negative and uncertain replies do not require an affirmation of presence.

## Instructor dates

**Check in → Attendance days → Manage dates** lists recorded sessions, scheduled semester meeting dates, and existing exclusions. Select several dates, optionally enter a reason, and choose **Check-in not required**. An additional-date field supports dates before a session exists and courses without a complete schedule. **Restore check-in requirement** reverses the exclusion.

Exclusions are per course/date. They remove dates from student attendance history, late recovery, absence date choices, and live check-in prompts. They exclude retained attendance and absence records from attendance counts and assessment history. Historical rows are retained. New sessions inherit the date policy. Only the course instructor can change it.

## Absence integration

A valid new absence report is saved before automated assessment. Until a decision is available, student history and the absence list show **Absence excuse requested**. A failed assessment leaves this request saved; students can edit their report to retry. Attachments remain transient and are not stored.

Successful assessments retain the existing automatic excused/unexcused procedure. Pending appeals show **Absence appeal pending**. Reported absences suppress late-recovery options and witness invitations, and the database rejects conflicting recovery. Pending, appealed, and excused dates do not count as missed classes in readiness scoring. Existing attendance on the same date stays aligned with the denominator.

No new instructor approval queue or notification was added. The existing instructor absence controls can resolve a pending report if the instructor chooses. A concurrent instructor decision wins over an automated assessment, and the action returns the stored decision.

## Verification

- `node scripts/test-attendance-recovery.mjs`: real migrations in isolated PGlite with fictional records; validates personal pledges, witness eligibility, explicit witness affirmation, denial of unsigned/non-witness/unauthorized actions, occupied and invalid seats, absence suppression, exclusions before session creation, restoration, preserved records, and immutable attendance identity.
- `node scripts/test-student-view.mjs`: existing migration, RLS, isolation, and practice attendance checks remain passing.
- Vitest covers request persistence before failed assessment, excluded assessment priors, concurrent instructor decisions, pending statuses, pledge checkbox resets, and bulk exclusion UI success/error states.
- Local browser fixture uses the actual React components and simulated actions at `scripts/preview-attendance.mjs`. Desktop and 390-pixel mobile checks covered neighbor failure, self pledge, witness pledge, bulk exclusion, attendance history, and horizontal overflow. This is not an authenticated production end-to-end test.
- External correctness and security review was explicitly authorized. Findings and final check results are summarized in `verification/attendance-recovery/results.md`.

The implementation intentionally relies on explicit attestations rather than strong attendance evidence. Students can coordinate false statements. No uploads, automated investigation, or instructor verification are required for pledge recovery.
