# Codex review — October 27, 2026

Mike explicitly authorized source review. The initial `codex review --uncommitted` pass and two subsequent custom correctness/security passes completed successfully. The pre-existing unrelated absence-report test was preserved. No production systems were accessed or modified.

## Findings and fixes

All six findings were P2 and are resolved:

1. **Email-safe snapshots:** SQL now applies the class-visible naming rule before persisting agreement/checkpoint names. Email-shaped profile names are ignored and email-only roster names use their local part.
2. **Explicit consent version:** confirmation requires an explicit matching agreement ID; absent, null, or stale IDs are rejected using a null-safe comparison.
3. **Independent classroom evidence:** unavailable project tasks no longer remove initiative evidence from new seats/shout-outs or leadership evidence from forming teams. Task inputs are suppressed while usable non-task evidence remains.
4. **Faculty task metrics:** contribution projects are excluded from faculty task statistics, matching the student task-statistics path. They no longer appear as zero-minute task teams.
5. **Stable roster comparison:** agreement confirmation and checkpoint creation compare enrollment/account identities rather than mutable names or display order. Name edits preserve consent and historical snapshot names; identity changes still require a new agreement.
6. **Student contract evidence:** readiness aggregates memberships and signatures independently of legacy task statistics, retaining signed contribution contracts in dependability evidence.

## Final reviewer result

The final pass confirmed all six findings resolved and reported no actionable new correctness, security, or lifecycle findings. It was a read-only source review, not a production or hosted Supabase verification.

Parent verification after the corrections:

- 847 tests passed across 70 files.
- 47 isolated PostgreSQL checks passed with fictional users and authenticated/anonymous roles.
- Production build and TypeScript check passed.
- ESLint passed on changed code; Git whitespace checks passed.

The review added regressions for missing/null/wrong agreement IDs, safe stored names, name-only changes, account-identity changes, retained classroom/leadership evidence, faculty mixed-mode task metrics, and student contribution-contract dependability.

Production migration/deployment and real authenticated staging smoke testing remain separate release steps. No grades or official records were changed.
