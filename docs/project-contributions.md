# Project contribution check-ins

Implemented locally on October 27, 2026, from `../PROJECTS_CONTRIBUTION_HANDOFF.md`.
The initial implementation was local. Mike authorized the production migration and deployment on October 27 after the clean Codex review. Deployment evidence is recorded separately; no grade writes are part of this feature.

## Delivered

- [x] Contribution mode defaults for new projects; title-first creation and optional editable brief.
- [x] Existing projects retain task mode, task boards, records, and contract cards.
- [x] Exact 100% work allocations, draggable bars, numeric entry, locks, equal reset, and reference markers.
- [x] Explicit proposals and unanimous confirmations; previous confirmed versions remain available while a revision is pending.
- [x] Contribution-mode contracts can be edited and signed without creating task minutes. Edits clear signatures atomically; signing checks the reviewed text.
- [x] Instructor-created checkpoints snapshot member IDs, account IDs, names, and the applicable confirmed agreement.
- [x] Private actual-work and fixed-pool 100-point credit charts; drafts, explicit submission, inability to assess, explanations, and requests for help.
- [x] Instructor completion, identified responses, self/peer comparisons, peer count/range, credit range, and missing feedback.
- [x] Server-enforced deadlines, revision conflicts, duplicate confirmation handling, roster-change checks, and recorded deadline revisions/reopening.
- [x] Database privacy policies and authenticated transactional mutations; no service-role access for contributions.
- [x] Contribution-only memberships do not generate zero task signals. Task-derived work ethic is unavailable in that case, and scoring normalizes over available competencies. Classroom initiative, team leadership, and contract evidence remain available independently of task records. Peer assessments never feed participation or grades. Existing task evidence remains usable in mixed-mode courses.

## Using the feature

1. Create a project with **Work shares and private check-ins**, then open it to students.
2. Students create/join teams through the existing team controls and review the team contract.
3. In **Work split & check-ins**, a member proposes shares. Every member separately confirms the same version, including when shares are equal.
4. The instructor selects the team and opens a checkpoint with a title and deadline. A confirmed agreement matching the current roster is required.
5. Each student saves a draft or submits both charts. Credit is a shared pool of 100 points, not an individual grade out of 100. A zero-work entry or a difference greater than one point between work and credit requires an explanation when submitting.
6. The instructor reviews submitted responses and requests for help. Unsubmitted drafts remain private to the respondent. Missing and declined feedback are never filled with zeros.

Deadline entry uses the device's local timezone; displayed deadlines include the timezone abbreviation. The server receives an ISO timestamp and checks the database clock inside the transaction. Changing a deadline preserves the checkpoint roster and agreement and records the prior/new deadline and actor. Submitted responses stay submitted when edited; stale revisions fail instead of overwriting another tab.

Allocations store integer hundredths of a percent totaling 10,000. Largest-remainder rounding uses stable member order. When all adjustable remaining weights are zero, remaining credit is divided equally. If every other bar is locked, movement is disabled. Reset clears locks explicitly.

## Data and authorization

Migration: `supabase/migrations/0053_project_contributions.sql`.

Existing project rows are backfilled to `tasks` before the database default changes to `contribution`. No historical minutes are translated to ratings. New agreement/checkpoint/response tables allow authenticated reads through RLS and no direct student writes. `contribution_command` derives identity from `auth.uid()`, scopes the team to its real project/course, serializes team/roster mutations, and validates the full snapshot roster and both distributions. The server action also checks the supplied course/project/team tuple using the caller's ordinary session.

Response reads permit only the respondent or, for explicit submissions, the course owner. Current teammates cannot read one another's responses even through direct queries. New teammates cannot access earlier checkpoints. Historical snapshots remain unchanged when memberships change; a new work agreement must be proposed and confirmed for the new roster. Students who leave a team retain database read access to their own historical snapshots/responses but cannot keep submitting on behalf of that team. The current application team picker continues to show the student's current team.

Proposals use an expected latest-agreement ID. Responses use an expected revision. Repeating an already-applied confirmation is harmless; repeating a stale response save returns a refresh instruction. The last confirmed agreement is not replaced by a proposal. Faculty opening a checkpoint during a pending revision uses the last confirmed agreement if its roster still matches.

## Verification

- `npm run test -- --run`: **847 tests passed across 70 files**, including allocation, privacy-boundary, component-flow, and review regression tests.
- `node scripts/test-contributions.mjs`: **47 PostgreSQL checks passed** in an isolated PGlite database with fictional users and authenticated/anonymous roles. Covers migration defaults, exact allocation validation, consent, contract signatures without task minutes, direct-query privacy, draft privacy, impersonation attempts, direct write denial, stale revisions, deadlines/reopening, preserved agreement history, roster changes, and cross-course membership injection.
- Production build and TypeScript check passed. ESLint and whitespace checks run on changed code.
- Browser checks used the actual React components in the local fictional-data preview. Keyboard ArrowRight changed 25.00 to 25.01, locks disabled the relevant control, and emulated touch dragging preserved the 10,000-unit total.
- Desktop 1440px and emulated phone 390px views were inspected. Student and instructor views fit the viewport; the instructor table scrolls within a keyboard-focusable region.
- The corrected student screen's WCAG A/AA axe audit reported zero automatic violations. Its inherited textured background required manual contrast review; new screen copy uses foreground-derived text and primary actions use foreground/background tokens.
- Screenshots: `docs/verification/project-contributions/`. They contain fictional data only.

These checks do not establish real-device compatibility or verify deployment against the current hosted Supabase database. The database suite boots the original Projects schema and the new migration with minimal course/auth fixtures; a real authenticated staging smoke test remains part of release validation.

Mike explicitly authorized the separate Codex review on October 27. Three review passes identified six issues, which were corrected and covered by regressions. The final source/security review confirmed all six resolved and reported no actionable remaining findings. See `docs/verification/project-contributions/review.md`. The reviewer did not access production or edit files; the parent ran the tests, database checks, lint, and build. Impeccable's context engine was unavailable, so source context and the incumbent styles were inspected directly. Design documentation/review was performed in-thread; no independent design-review verdict is claimed.

The UI extends the existing Hanken Grotesk/Fraunces type system, warm paper/ink tokens, standard inputs/buttons, border radii, and restrained grid spacing. The contribution panel scopes its accessible action colors locally. Global theme files were preserved; pre-existing theme contrast and missing global design documentation were not canonized or broadened into this change.

## Local preview and repeatable checks

Run `node scripts/preview-contributions.mjs`, then open `http://127.0.0.1:4513/`. The preview offers student, instructor, pending-proposal, and first-agreement scenarios using fictional data. Its action adapter makes no database writes and does not simulate persistence. It reuses locally built fonts when available and falls back to system fonts before a build. It is a development harness outside the Next.js app routes.

For isolated SQL checks, install `@electric-sql/pglite` under `../.classact-verification` and run `node scripts/test-contributions.mjs`. Alternatively set `CLASSACT_PGLITE_MODULE` to the module's import path. This optional test dependency is outside the application repository and does not change application dependencies.

`scripts/test-contribution-touch.mjs` accepts the CDP endpoint from the isolated preview browser's `get cdp-url`. It only operates on the existing `http://127.0.0.1:4513/` tab and uses emulated touch events. Closed proposal details contain hidden sliders; the test explicitly selects visible controls.

## Release boundary

Apply migration 0053 in a disposable/staging Supabase database first, then exercise the real create-team → unanimous agreement → checkpoint → student submission → instructor review flow with test accounts. Verify that a second student cannot fetch the first student's response using the hosted API. Confirm legacy project behavior and course metrics with mixed modes. Deploy application code only after the migration is present. Mike explicitly authorized production migration and deployment on October 27. The contribution schema was applied in a transaction and its tables, RPC, row-level security, and preservation of existing task projects were read back successfully before code release.

There is no feedback-release workflow, automatic penalty, misconduct label, Canvas write, or automatic grade allocation. Those remain outside this version's scope.
