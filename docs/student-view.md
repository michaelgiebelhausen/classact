# Student View

Implemented locally on October 28, 2026. Not deployed.

An instructor opens **Student view** beside their account controls while inside a course. The corresponding assignment/project is mapped to its private practice copy; instructor-only pages fall back to the course home. **Exit student view** returns to the corresponding source page. No authentication cookies or account sessions are exchanged.

The instructor has a student enrollment in a separate course owned by an internal Auth identity (random `.invalid` address, no password, no email delivered). Consequently the existing pages, actions, and database student permissions apply without a UI-only role override. One practice copy is retained per source course. Other students cannot join it, even through service-role join flows. It is omitted from the instructor's normal dashboard and onboarding membership counts.

## Snapshot and practice behavior

Copies course configuration, seat geometry with remapped neighbors, assignments and instructor criteria, open projects and task templates, lecture materials, active lecture/poll snapshots, and open exercise prompts with a solo practice group. Source files are referenced read-only under the instructor's existing file permissions. Student uploads use the new course/enrollment identifiers.

Does not copy real enrollments, student submissions, notes, grades, poll votes/totals, discussion pairs, project teams, contribution agreements/responses, or rubric source quotations. Accordingly personal history starts empty and peer-dependent activities have no classmates. This is a snapshot, not a live mirror; reopening preserves practice work and **Reset practice student** copies current source content again.

Dates and assignment lifecycle states are initially preserved. **Reopen practice assignments for 7 days** permits submission practice without changing source dates. A practice attendance session opens on entry, using the course timezone. Poll/exercise prompts present at snapshot time can be answered using the existing student workflows. Email delivery, AI credential resolution, automated grading, and cross-course absence evidence are suppressed for practice courses. AI-dependent screens therefore cannot complete paid processing in this version.

Reset requires confirmation and the exact expected practice-course ID. The RPC serializes creation/reset by source, rechecks ownership, and performs snapshot replacement transactionally. A stale tab cannot delete a newer copy. Reset deletes practice database activity; previously uploaded storage objects are not currently garbage-collected and existing signed file URLs can remain valid until expiry. No source files are deleted.

## Release requirements

Apply `supabase/migrations/0054_student_view.sql` before deploying this code. The schema health contract includes its three course columns. Service-role configuration and Auth admin create-user access are required to create a practice copy; ordinary notes email continues to use its existing authenticated client. No production migration, deployment, accounts, or practice records were created during this implementation.

After deployment, perform an authenticated smoke test with an instructor-owned test course: enter from an assignment, submit a harmless file, check into a seat, navigate to another course section, reopen/reset, and exit to the original page. Verify another account cannot access the practice course and that source totals remain unchanged. Local verification below does not replace this Auth/Storage integration check.

## Verification

- Full Vitest suite: 862 passing tests across 75 files.
- Production build and TypeScript passed. ESLint has no errors; its existing warning in `scripts/test-contribution-touch.mjs` is unrelated.
- `node scripts/test-student-view.mjs` loads the real migrations in isolated PGlite (platform cron extensions excluded), then verifies ownership, RLS, hidden instructor permissions, denial of other enrollments, fresh IDs, no copied submissions/votes, practice attendance/submissions/votes/exercise persistence, reset cleanup, stale-reset rejection, and preservation of source records.
- Browser checks exercised the actual header/sidebar components in the explicit local fixture at desktop and a 390-pixel emulated viewport: entry, route mapping, practice options, reset confirmation/cancel, exit, and no horizontal overflow. The fixture mocks course-creation actions; it is not an authenticated end-to-end app test.
- Independent code/security review found and prompted fixes for ordinary notes-email credential compatibility, practice absence-appeal email suppression, stale reset races, and missing initial exercise response rows. The final review passed with no remaining actionable findings and independently reran the isolated SQL test.

Local UI fixture: `node scripts/preview-student-view.mjs`, then open `http://127.0.0.1:4514/course/live/assignments/a`.
