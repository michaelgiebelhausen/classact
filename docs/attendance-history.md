# Student attendance history

Release prepared October 28, 2026. No database migration is required.

The student check-in page includes **See my attendance record** inside **Forgot to check in?**. It expands in place and reads fresh data when opened or refreshed. It works for real student enrollments and the instructor's isolated practice enrollment.

The list contains recorded class sessions through today in the course timezone, newest first. It does not generate attendance dates from the timetable or assume an opened session proves class met. Unrecorded or cancelled dates need instructor reconciliation. A practice course shows its own session history, not the source course's student records.

Each date distinguishes a recorded check-in from confirmed presence. Active disputes take precedence; instructor or peer confirmation establishes presence. A pending late request stays pending. Historical late approvals cannot override a removed or newly unverified check-in. Excused/unexcused absence decisions and pending appeals remain visible. Missing check-ins are not labelled as proof of absence.

The read-only server action derives the active enrollment from the authenticated user before privileged access. It scopes every query to the course, student's enrollment, and session/date batch. Only status fields reach the client; explanations, documentation, internal absence scores, and classmates' records are not returned. Session pagination prevents a truncated history; any query error fails the whole load instead of showing apparent missed classes.

## Verification

- 880 tests passed across 78 files, including authorization, query scoping, timezone, pagination, status precedence, load/retry, and empty history.
- Production build and TypeScript passed. ESLint had no errors and one pre-existing warning in `scripts/test-contribution-touch.mjs`.
- Independent code and security reviews passed; final review also checked removed/unverified check-ins against historical late approval.
- Actual UI components exercised in the local fixture at desktop and an emulated 390-pixel viewport. Mobile uses stacked records; desktop uses a table. Loading, failure/retry, and empty states were checked. This fixture uses synthetic records and mocked actions; authenticated production integration has not been exercised for this addition.

Preview: `node scripts/preview-student-view.mjs`, then `http://127.0.0.1:4514/course/practice/checkin`. Query parameters `?history=empty` and `?history=error` exercise alternate states.

For release, commit/push the feature and verify the live control with an instructor's private practice enrollment. Preserve the unrelated untracked `ReportAbsence.test.tsx`.
