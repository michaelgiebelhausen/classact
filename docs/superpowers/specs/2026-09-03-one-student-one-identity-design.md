# One student, one identity

Design for making it impossible for a student to end up as two people in
ClassAct, and for the app to keep working if a duplicate slips through anyway.

Status: proposed, awaiting Mike's review. Nothing here is implemented except
the read-side change noted in "Already shipped".

## Why this keeps happening

Two real cases on 2026-09-03:

| Student | What existed | What broke |
|---|---|---|
| Olivia Smith | Two **auth accounts**: `osmith7@clemson.edu` (roster, empty) and `olsmith7@clemson.edu` (typo at the join form on 09-01, all her activity) | Correct email + password from the other account = "incorrect". Reset email went to the empty account. |
| Thomas Garrett | One account, two **enrollment rows** in one course: roster row `tgarre3@clemson.edu` and join-code row `thomasjgarrett34@gmail.com` (from before the join route checked by profile) | Every page asks for exactly one row; two rows read as "not enrolled". No seat to click, absent from the map. |

Earlier this term: Meredith (icloud.com vs `mfreem4@clemson.edu`), fixed by
hand with `matchToCanvasRow`; the g.-twin Google case, fixed with
`emailAliasOf`. Each fix closed one door. The reason doors keep opening is a
single design choice:

**The app identifies a student by email string at every write, but a student
is really an auth account (`profiles.id`).** A person has one account and any
number of email strings: the registrar's, Canvas's, Google's g.-twin, a
personal one they typed at the join form, a typo. Every writer that keys on
the string can create a second row or a second account for the same person.

### The writers, and what each keys on

| Path | File | Creates | Keys on | Checks by profile? |
|---|---|---|---|---|
| Join form, password-first | `src/server/actions/auth.ts` `signUpAndJoin` | auth account for **any** email | email | n/a |
| Join form, email link | `sendJoinLink` (`createIfMissing: true`) | auth account for any email | email | n/a |
| Sign-up page | `signUpWithPassword` | auth account | email | n/a |
| Post-auth join landing | `src/app/auth/join/route.ts` | enrollment | email + g.-twin, then profile | yes, since 08-28 |
| Roster CSV import | `src/app/api/roster/import/route.ts:65` | `invited` enrollment per email not already on the roster | email | **no** |
| Canvas sync | `src/server/actions/canvas.ts:364` | `invited` enrollment per email not already on the roster | email | **no** |
| Activation email ("set a password") | `src/server/actions/activation.ts:170` | recovery link for `roster_email` | email | n/a |
| Professor merge | `matchToCanvasRow` | merges two rows, sets `profiles.school_email` | ids | founder-only |

`profiles.school_email` is the one place the app records "this account is
that roster address", and today only `matchToCanvasRow` writes it and only
`stageroster` reads it. None of the writers above consult it.

### How a split compounds

1. Student joins by code with a personal address before the roster is imported. One row, linked to their account.
2. Professor imports the roster or syncs Canvas. Import sees the school address is "not on the roster", inserts a second `invited` row. Now Thomas.
3. Professor sends activation emails. The `invited` row's address gets a "set a password" link. The student clicks it and creates a **second account** under the school address. Now Olivia, without a typo.
4. Each account sees a different half of the class. Whichever one they use for attendance is the one that "doesn't work" for grading, or vice versa.

Step 2 is the hinge. Everything downstream follows from one email-keyed insert.

## Goal

A student who does any combination of: join by code, get imported, get
synced from Canvas, sign in with Google, mistype their email once, or use a
personal address, ends up with **exactly one account and exactly one
enrollment row per course**, and the rare leftover cannot take a page down.

Non-goals: matching people by name similarity, guessing that two different
domains are the same person, or removing off-roster joining. A join code
must keep working for a course with no roster at all.

## Approaches considered

**A. Enforce the invariant in the database and make every writer merge-aware.**
A partial unique index says one non-dropped row per (course, profile). Roster
import and Canvas sync resolve each incoming email to an account *before*
inserting, and attach the roster identity to the row that account already
holds. The join route merges instead of re-pointing. Recommended: it closes
the hinge (step 2) and makes the rest structurally impossible rather than
patched case by case.

**B. Keep the read-side tolerance and add professor repair tools.** Cheap,
and half of it shipped today. But duplicates keep accumulating, activation
emails keep recruiting second accounts, and every merge is a founder chore.
Not sufficient on its own.

**C. Only allow account creation for addresses already on a roster.** Would
have stopped Olivia's typo. Also stops every join-code-first class, the
exact flow the product promises. Rejected.

Recommendation: A, with the join-form guard from C narrowed to the
mismatch case only (see component 4), and B's read-side tolerance kept as
the safety net.

## Design

Four writers change, one invariant is added, one tool is added. Each unit
is independently testable.

### 1. Resolver: email → account (`src/server/identity.ts`, new)

One function every writer calls instead of comparing strings:

```
resolveProfileForEmail(admin, email): Promise<string | null>
```

Checks, in order, and returns the first account id found:

1. `auth.users.email` equals the address or its g.-twin (`emailAliasOf`).
2. `profiles.school_email` equals the address or its g.-twin.
3. Any enrollment anywhere with `roster_email` equal to the address or its twin that already has a `profile_id` (the student claimed that address in another course).

Reads only. Uses the existing 60-second auth-facts cache from
`stageroster.ts` so a 300-row import is one auth call, not 300.

### 2. Roster import and Canvas sync attach instead of insert

Today: `fresh` = incoming emails not present among the course's rows → insert.

New, per incoming row whose email is not on the roster:

- Resolve the email to an account. If none: insert `invited` as today.
- If the account already has a non-dropped row in this course (the personal-address row): **update that row** with the roster identity (`roster_email`, `roster_name`, `roster_photo_path`, `roster_name_phonetic`, `canvas_user_id`, `status: active`) and record `profiles.school_email`. No second row, and the activation emailer now has nothing to recruit.
- If the account exists but has no row here: insert as today with `profile_id` already set and `status: active`. The student never needs the activation email.

The `(course_id, roster_email)` unique constraint stays. Because we update
the existing row's `roster_email` to the official one, the personal address
is no longer on the roster; that is the intended outcome and matches what
`matchToCanvasRow` already does by hand.

### 3. Join route merges instead of re-pointing

`/auth/join` currently: match a roster row by email; if found, set its
`profile_id` to me. If the signed-in account already holds a *different*
row in this course (joined earlier under a personal address, roster imported
since under the school address), that re-point produces two rows for one
account and violates the new index.

New: when the matched roster row and the account's existing row differ,
call the same merge used by `matchToCanvasRow` (`planCanvasMatch` decides
which row keeps the history; twenty-two tables cascade off enrollments, so
the row with check-ins survives). The route gains no new decision logic; it
reuses the founder tool's plan under the student's own identity.

### 4. Join form: confirm before creating an account for an address the roster doesn't know

`signUpAndJoin` and `sendJoinLink` create an account for any string. Change:
if the course behind the code has at least one roster row (it was imported
or synced) **and** the typed address resolves to no account and matches no
roster row (exact or g.-twin), the form shows one interstitial:

> We don't see **olsmith7@clemson.edu** on the roster for Marketing Research. If your school gave you a different address, use that one. Otherwise continue and your professor will see you as a new joiner.

Two buttons: "Use a different email" and "Continue". No block, one screen,
only in the mismatch case. Olivia would have seen it. Thomas would have
been told to use his Clemson address. A course with no roster never shows
it. The check is one query and happens before `signUp` is called, so no
account is created for a typo that the student catches.

### 5. Database invariant (migration 0048)

```
create unique index enrollments_one_row_per_student
  on public.enrollments (course_id, profile_id)
  where profile_id is not null and status <> 'dropped';
```

Preceded in the same migration by a cleanup that, for each
(course, profile) with more than one non-dropped row, keeps the row with the
most `check_ins` (ties: the oldest) and deletes rows that have **no**
dependent history in any of the cascading tables. A duplicate that has
history on both rows is left alone and listed in the migration's output for
a hand merge; the index creation would then fail loudly, which is the
correct outcome.

The index is also what makes components 2 and 3 honest: a writer that
regresses gets a constraint error in tests, not a silent second row.

### 6. Founder tool: merge two accounts

`matchToCanvasRow` merges two *rows*. Olivia needed two *accounts* merged and
there is no tool, so it was SQL. Add `mergeAccounts(keepProfileId,
dropProfileId)` in `activation.ts`, founder-only, same shape:

- Refuse unless the dropped account has zero rows in the cascading tables outside `enrollments` (notes, photos, answers, presence). Otherwise it is a hand job by design.
- Re-point every enrollment of the dropped account to the kept one (component 5's index means each course must be checked; a collision uses the row merge from component 3).
- Delete the dropped auth user (profile cascades).
- Optionally rename the kept account's email to the dropped one's, when the dropped one is the roster address. This is the Olivia case.

Surfaced on the enrollment-management page next to the existing merge
control, only when two rows in the same course resolve to different accounts
with the same roster name or g.-twin addresses. It is a button the founder
clicks, not an automatic action.

### Already shipped (safety net, keep)

Commit `cd804c6`: all 32 "my enrollment" lookups order by `created_at` and
take one row. With the index in place this is belt-and-braces; without it,
it is what keeps a duplicate from blanking a student's pages.

## Edge cases, and which component answers each

| Case | Answer |
|---|---|
| Typo at the join form on an imported roster | 4 (interstitial) |
| Typo at the join form, course has no roster | Allowed; nothing to compare against. Professor sees a new joiner with an odd address. |
| Joined with personal email, roster imported later | 2 (attach to existing row) |
| Joined with personal email, Canvas synced later | 2 |
| Imported first, student signs in with Google g.-twin | Existing `emailAliasOf` in join route |
| Imported first, student signs in with a totally different personal address | Join route inserts a second row today → 3 refuses via index; student sees the component-4 interstitial first and is told to use the school address. If they continue, they get an off-roster row and the professor merges with the existing tool. |
| Activation email sent to an `invited` row whose address belongs to an account that already has a row here | 2 prevents the `invited` row from existing |
| Student drops (Canvas) and re-joins by code | Existing reactivation path; index excludes `dropped` |
| Professor uses own join code | Existing early return |
| Student changes account email (`account.ts`) | Unaffected: enrollment is keyed by `profile_id`, not by the string |
| Two accounts already exist (Olivia) | 6 (founder merge) |
| Two rows with history on both (rare) | Migration lists them; hand merge |

## Data flow after the change

```
email string ──resolve──▶ profile id ──▶ the one enrollment row for (course, profile)
                 │                              ▲
                 └─ no account ─▶ invited row ───┘ (claimed later by the join route, by profile)
```

## Testing

- `identity.test.ts`: resolver order and g.-twin handling; no account → null.
- `roster-import.test.ts` / `canvas.test.ts`: incoming email whose account already holds a row → update, no insert; account with no row → insert active with profile set; unknown → insert invited.
- `join-route.test.ts`: account with existing row + matched roster row → one row survives, history kept (both keep-branches).
- `join-form.test.ts`: interstitial shown only when roster exists and address unknown.
- Migration: run against a copy of prod; assert the index creates and the only listed leftover is none.
- `mergeAccounts`: refuses with history; re-points; deletes; renames.

## Rollout order

1. Migration 0048 (cleanup + index). Mike runs it by hand per the runbook. Thomas's Gmail row is removed by the cleanup.
2. Components 1–3 in one commit (they share the resolver), behind the index.
3. Component 4 (join-form interstitial).
4. Component 6 (account merge tool); use it to finish Olivia if the SQL hasn't been run by then.

## Open question for Mike

Component 4's interstitial is the only user-visible change students will
notice. The alternative is silent: let them through and rely on 2 and 3 to
merge later. My recommendation is the interstitial, because a typo is the
one case no merge logic can detect.
