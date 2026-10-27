# Late check-in through neighbors

Students use **Check in → Forgot to check in?** to choose a past class session
and their seat. There is no 14-day cutoff. The session must already exist;
future dates and dates with an existing attendance record are excluded.

The server selects the recorded occupants of the immediately left and right
seats for that session. Students cannot choose their witnesses. At an edge,
one available neighbor is sufficient. With no eligible recorded neighbor,
the transaction rolls back with an explanation. Seats already recorded as
occupied cannot be claimed. Late claims cannot serve as witnesses for other
late claims.

Each eligible neighbor gets a separate email containing the claimant's name,
course, date, seat, and actual lecture deck title(s) if a lecture ran on that
date in the course timezone. Missing lecture information is omitted. Addresses
and individual negative/uncertain replies are not exposed to the claimant.

Neighbors sign in and explicitly select yes, not present, or don't remember.
Email scanners and link opens cannot confirm anything. One yes creates a
verified check-in in the same transaction as confirming the request. There
is no automatic professor inbox escalation. Negative/uncertain answers and
silence do not award attendance. The claimant sees the pending state.

## Delivery and access

The two new tables have RLS with no direct client policies. Request and response
RPCs authorize the signed-in enrollment inside security-definer transactions.
The request locks the session and has a unique student/session constraint.
Responses lock the request so simultaneous yes votes cannot create duplicates.
Read models use the service client only after active enrollment is established;
students receive their own requests and invitations addressed to them.

Email requires configured Resend and Supabase service-role access. Failure
preserves the request and exposes Retry emails. Five-minute delivery leases
and provider idempotency keys limit duplicate sends, including interrupted
attempts. Provider acceptance is recorded, not proof of inbox delivery.

## Release requirements and limits

- Apply `supabase/migrations/0051_late_checkins.sql` before enabling the new
  application code. Existing check-in remains usable when the new feature is
  unavailable. The schema contract identifies the missing tables/columns.
- No migration was applied to a live database, no messages were sent, and no
  deployment was performed during local implementation.
- Local UI interaction tests exercise request submission, explicit replies,
  delivery failure, pending/confirmed states, and unavailability. Live RPC
  authorization, concurrent transactions, delivery and authenticated browser
  flow still require a connected test environment before release.
- Existing data retains session check-ins but not a versioned room layout.
  Historical requests resolve adjacency using the currently stored seat labels
  and neighbor map. A room redesign can make an older seat unavailable or its
  adjacency inaccurate. Do not enable for a course whose room has changed
  without reconciling its historical layout.
- Tests must confirm that one yes awards attendance without a networking point,
  a second yes is harmless, a non-witness cannot reply, cross-course seats are
  rejected, occupied seats stay occupied, and duplicate requests send no new
  round of invitations. Exercise retry after a simulated provider failure.

After explicit authorization, independent `codex review --uncommitted` ran.
It found that the request's seat foreign key blocked classroom replacement.
The foreign key now cascades deletion, matching the existing seat-linked
attendance records. Explicit classroom replacement removes associated late
requests and their witness invitations, so stale invitations cannot recreate
attendance against deleted seats. The security review then found that raw
roster names could expose email addresses for course-code joiners. Both the
read model and email path now use `rosterDisplayName`, including the chosen
profile name when available. The final external correctness/security review
confirmed both fixes and reported no additional actionable findings. Three
new read-model tests verify email-backed names are sanitized, chosen profile
names are used, and unsigned viewers never open the service client.

## Local verification, October 27, 2026

- Existing suite: 807 tests passed. Full suite after the classroom replacement
  fix: 821 tests passed across 64 files. After the privacy fix, 66 affected
  feature/name tests and three new read-model regression tests passed. Final
  full-suite verification: **824 tests passed across 65 files**. TypeScript
  and scoped ESLint checks passed again after the privacy fix.
- TypeScript check passed; scoped ESLint check passed.
- Production build blocked while fetching the existing Fraunces and Hanken
  Grotesk Google Fonts. No font or unrelated application changes were made.
- No PostgreSQL instance or authenticated live environment was used; the SQL
  migration and real email flow remain unverified at runtime.
