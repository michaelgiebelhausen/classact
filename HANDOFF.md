# ClassAct — Go-Live Runbook

Written for Professor Mike. The entire app is built and compiles cleanly, but it
was built **without your live keys**, so nothing is connected yet. Work through
this list top to bottom — roughly 45–60 minutes — and you'll have ClassAct
running at a real URL.

Everything you paste lives in one file locally: copy `.env.example` to
`.env.local` and fill values in as you collect them.

---

## 1. Connect the GitHub repo (5 min)

The code is committed to a local git repo but not yet pushed (I didn't have
your repo URL or credentials).

1. Open a terminal in this folder (`ClassAct`).
2. Point it at your "Class Act" repo — replace `<URL>` with your repo's URL
   (it looks like `https://github.com/YOURNAME/ClassAct.git`, find it under the
   green **Code** button on GitHub):
   ```
   git remote add classact <URL>
   git push -u classact main
   ```
   ⚠️ Note: this folder's old `origin` remote points at an unrelated repo
   (`AIS-OS`) — that's why we're adding a new remote name instead of pushing
   to origin.

## 2. Wire up Supabase (15 min)

You already created the "Class Act" project at supabase.com. Now:

1. **Get your keys:** Supabase dashboard → Project Settings → API. Copy into
   `.env.local`:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` *(keep this one secret —
     never share it or put it anywhere public)*
2. **Create the database tables:** dashboard → SQL Editor → New query. Open
   `supabase/migrations/0001_init.sql` in this folder, paste the whole thing,
   Run. Repeat for `0002_rls.sql`, `0003_storage.sql`,
   `0004_canvas_photos.sql`, `0005_follow_along.sql`,
   `0006_participate.sql`, `0007_name_phonetics.sql`,
   `0008_roster_phonetics.sql`, `0009_projects.sql`,
   `0010_exercises.sql`, `0011_rooms.sql`, `0012_schedule.sql`,
   `0013_assignments.sql`, `0014_shoutouts_participation.sql`,
   `0015_byok_billing.sql`, `0016_lecture_pause.sql`,
   `0017_canvas_connections.sql`, then `0018_feedback.sql` (order matters).
   Each should say "Success".
   **Then run `supabase/catchup_0019_to_0023.sql`** — one idempotent script
   covering 0019–0023 (profile answers, LinkedIn, deck order, term dates,
   sign-up role). It ends with a five-row verification query; every `ok`
   must come back true. Skipping it 404s Setup and Check-In, because the
   app selects columns those migrations add.
   **Then run `0024_protect_billing_columns.sql`, `0025_absences.sql`,
   `0026_invite_message.sql`, `0027_canvas_resync.sql`, and
   `0028_course_order.sql`, in that order.** (0025 adds self-reported
   absences; 0026 adds the editable invite email plus the per-student record
   of which invites actually went out; 0027 adds the remembered Canvas
   linkage + the 'dropped' enrollment status that powers add/drop resync;
   0028 adds the professor's drag-to-reorder dashboard course order. Setup
   throws a "missing column" error until 0027 has run, and the professor
   dashboard needs 0028.)
   *(0011 adds seat geometry + the shared room database; 0012 adds the
   class schedule that auto-opens check-in; 0013 adds Tasty Grading; 0014
   adds shout-outs + the professor's participation cockpit; 0015 adds the
   BYOK key vault + billing flags; 0016 adds lecture pause windows so
   professor-sanctioned browsing never dings focus scores; 0017 adds the
   per-professor Canvas token vault (professors connect their own token in
   Setup → Roster; the env CANVAS_* pair becomes a founder fallback) — the
   app queries these columns, so it breaks without them.)* After 0015, mark
   your own account founder so
   your courses keep using the env OpenRouter key:
   `update profiles set founder = true where id = '<your-user-uuid>';`

2b. **BYOK + billing setup (docs/byok-billing-plan.md):**
   - Generate `APP_ENCRYPTION_KEY` (64 hex chars) for `.env.local` / Vercel:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     Professors' OpenRouter keys are AES-encrypted with it — losing/rotating
     it means everyone re-enters their key.
   - Stripe (only when you flip `BILLING_ENABLED=true`): create a $5/mo
     recurring Price in the Stripe dashboard → set `STRIPE_PRICE_ID` and
     `STRIPE_SECRET_KEY`. Add a webhook endpoint for
     `<site>/api/stripe/webhook` sending `checkout.session.completed`,
     `customer.subscription.updated`, `customer.subscription.deleted` →
     set `STRIPE_WEBHOOK_SECRET`. Local dev:
     `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
   - Comp a friendly professor: `update profiles set comp = true where id = '<uuid>';`
3. **Check Realtime is on:** dashboard → Database → Replication → make sure
   the `supabase_realtime` publication includes `check_ins`, `lectures`,
   `focus_events`, `poll_rounds`, `poll_answers`, and `poll_pairs`
   (migrations 0002/0005/0006 add them; just confirm).
4. **Canvas roster sync (optional):** to pull students + ID photos straight
   from a Canvas course, set in `.env.local` (and later in Vercel):
   - `CANVAS_BASE_URL` — e.g. `https://clemson.instructure.com`
   - `CANVAS_API_TOKEN` — Canvas → Account → Settings → New Access Token
5. **AI think-pair-share questions (OpenRouter):** set in `.env.local` (and
   later in Vercel):
   - `OPENROUTER_API_KEY` — openrouter.ai → Keys → Create Key (server-only;
     treat like a password)
   - `OPENROUTER_MODEL` — optional; defaults to `anthropic/claude-sonnet-5`.
     If generation errors mention the model, set this to a Claude model your
     OpenRouter account can use (it needs PDF/file input support).
6. **Auth redirect URLs:** dashboard → Authentication → URL Configuration:
   - Site URL: `http://localhost:3000` for now (change to your live URL later)
   - Redirect URLs: add `http://localhost:3000/**`

7. **Turn OFF email confirmation, and fix three templates — REQUIRED.**

   **a. Authentication → Sign In / Providers → Email → uncheck "Confirm
   email".** This is the single highest-leverage setting in the product.
   `signUpAndJoin` already returns a session when confirmation isn't
   required, so a student with a join code and a password is simply in — no
   email, no link, nothing that can expire. Done 2026-08-26.

   **b. Authentication → Emails → Templates.** Three of the six matter.
   In each, replace ONLY `{{ .ConfirmationURL }}` inside the `href`, leaving
   the surrounding HTML alone:

   | Template | Replace the href with |
   | --- | --- |
   | **Magic link or OTP** | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink` |
   | **Reset password** | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery` |
   | **Confirm sign up** | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup` |

   **Magic link or OTP is the one that actually matters** and was missing
   from this runbook until 2026-08-26. It backs "Email me a sign-in link
   instead" and the join-by-code flow — the two `signInWithOtp` calls in
   `server/actions/auth.ts`. Confirm sign up stops being sent once (a) is
   done; set it anyway so re-enabling confirmation later doesn't restore the
   trap. Reset password is bypassed by the app's own "Can't get in?" flow,
   which mints its own link and sends via Resend.

   Skip **Invite user** (ClassAct sends its own via Resend, deliberately —
   Supabase's built-in mailer is throttled far below a 40-student class),
   **Change email address**, and **Reauthentication**: no code path reaches
   them.

   The `type=` value must match the template — `/auth/callback` passes it to
   `verifyOtp`, and a mismatch fails.

   If a template contains `{{ .Token }}`, that's the six-digit-code variant;
   the app has no path for typed codes, so keep the link form.

   **Why this matters more than it looks.** The stock templates use
   `{{ .ConfirmationURL }}`, which routes through Supabase's `/auth/v1/verify`
   and hands back a PKCE `code`. `@supabase/ssr` pins `flowType: "pkce"` and
   cannot be talked out of it, and PKCE keeps a `code_verifier` **cookie in the
   browser that started the sign-up**. A student who signs up on a laptop and
   opens the email on their phone therefore *cannot* complete sign-in — the
   link is fine, the cookie is simply not there. In the Fall 2026 pilot this
   stranded 37 students who had confirmed their email and still could not get
   in.

   A `token_hash` link is verified with `verifyOtp`, which reads no local
   storage at all, so it opens on any device. `/auth/callback` accepts both
   shapes, so switching the templates is safe and links already sitting in
   inboxes keep working.

## 3. First local run (5 min)

```
npm install --legacy-peer-deps
npm run dev
```

Open http://localhost:3000 — you should see the ClassAct landing page.
Sign in with your email; the magic link (in early testing, Supabase sends it
from its own email service) logs you in. Create a course, build a 5×8 room,
and you're looking at the real product.

**Optional demo data:** to fill a classroom instantly:
```
npx tsx --env-file=.env.local scripts/seed-demo.ts you@clemson.edu
```

## 4. Deploy to Vercel (10 min)

1. vercel.com → Add New Project → import your "Class Act" GitHub repo.
2. Framework auto-detects Next.js. Before deploying, add Environment
   Variables — every line from your `.env.local`, plus set
   `NEXT_PUBLIC_SITE_URL` to your production URL (e.g.
   `https://classact.college` once the domain is attached, or the
   `*.vercel.app` URL to start).
3. Deploy. Then go back to Supabase → Auth → URL Configuration and add your
   production URL (`https://classact.college/**` and/or
   `https://your-app.vercel.app/**`) to the redirect list, and update Site URL.
4. To use **classact.college**: Vercel project → Settings → Domains → add it,
   then follow Vercel's DNS instructions at your domain registrar.

## 5. Email — Resend (10 min, can wait)

Until this is done, invite emails won't send — but the app already falls back
to a **copyable join link**, so you can pilot without it.

1. resend.com → create account → Domains → add `classact.college` → add the
   DNS records they show you at your registrar → verify.
2. API Keys → create one → put in `RESEND_API_KEY` (locally and in Vercel).
3. `EMAIL_FROM` is already set to `ClassAct <noreply@classact.college>`.

**Also recommended:** Supabase → Auth → SMTP settings → point Supabase's
magic-link emails at Resend too, so sign-in emails come from your domain and
don't hit Supabase's low free-tier email limits (important before 40 students
sign in at once).

## 6. Analytics & error tracking (5 min, optional but recommended)

- **PostHog:** posthog.com → new project → copy the project API key →
  `NEXT_PUBLIC_POSTHOG_KEY`. Events already instrumented: course_created,
  roster_imported, onboarding_completed, checkin_completed, neighbor_verified,
  game_played.
- **Sentry:** sentry.io → new Next.js project → copy the DSN →
  `NEXT_PUBLIC_SENTRY_DSN`. PII scrubbing is already configured.

Both are silent no-ops until their keys exist — nothing breaks without them.

## 7. Pilot smoke test (15 min — do this before the first real class)

Use two browsers (or one normal + one incognito) so you can be professor and
student at once:

- [ ] Professor: sign in → create course → Setup → build your real room's grid
- [ ] Professor: Roster tab → upload a CSV (`name,email` — export from Canvas)
- [ ] Professor: Invite tab → copy the join link (or send email invites)
- [ ] Student (incognito): open join link → magic link → onboarding → add a
      photo + answers
- [ ] Professor: course home → **Open today's session**
- [ ] Student: Check in → tap a seat → see it fill on the professor's screen
      within ~2 seconds
- [ ] Second student (another private window): check in next to the first →
      confirm neighbor → first student shows **verified**
- [ ] Student: play both name games (needs 6+ students with photos — seed
      script gets you there for testing)
- [ ] Both: Metrics pages show sensible numbers
- [ ] Student: Profile → Delete my photos & answers → confirm it works

## At the front of the room — unsticking a student in under a minute

No migration needed. Open the class page and work the **Stuck — needs you**
list. Each person carries what they actually need:

- **needs a password** — confirmed their email, never got a session. Press
  **Reset**, then have them go to `classact.college/join/<JOIN-CODE>` and sign
  up with any password. With email confirmation off they are in immediately.
  Their attendance and Canvas photo survive; only the dead account goes.
- **needs an invite** — their account already works, they just aren't enrolled
  here. Do NOT reset (it would destroy a working login and fix nothing). Give
  them the join code; the same URL enrols them.
- **invite bounced** — the address is wrong or rejecting mail. Fix the address
  in Setup before anything else.

The join URL is printed at the top of that section so it can be read out.

Emailing set-password links is the calmer option **outside** class, and the
buttons for it are still there. In class it is a round trip through a
student's inbox while the room waits, which is the friction this replaces.

Reset refuses any account that has ever been signed into — that is the one
action here with no undo, and a working login is never the problem.

## Canvas sync on the roster (CA-8) — needs 0030 AND 0031, both BEFORE deploying

Neither is safe to defer: the sync selects `canvas_missing_since` (0030) and
`canvas_seen_at` (0031). If either column is absent the query fails, the sync
reads the existing roster as empty, and tries to re-import every student —
which collides on the unique email constraint and reports "Import failed".

**0031 is what makes the departures section mean anything.** 0030 inferred
"no longer on Canvas" from absence alone, which cannot tell "was on the Canvas
roster and left" from "was never on it" — so students who joined with a course
code on a personal Gmail were listed as drop candidates forever. `canvas_seen_at`
records that a sync actually matched or imported the student, and only rows
carrying it can ever be flagged. It also backfills once, using the rule that a
roster row whose *name* is an email address was created by `/auth/join` rather
than by an import (the same rule `isEmailAddress` in lib/names.ts documents).
That backfill is a heuristic: it can wrongly include a CSV-imported student,
who then appears as a drop candidate and simply isn't ticked. It cannot wrongly
include a join-code student, which was the bug.

## Canvas sync on the roster (CA-8) — needs migration 0030 FIRST

**Run `supabase/migrations/0030_canvas_missing.sql` BEFORE deploying this
code.** Unlike 0029, this one is not safe to defer: the sync selects
`canvas_missing_since`, and if the column is absent the query fails, the sync
reads the existing roster as empty, and tries to re-import every student —
which collides on the unique email constraint and reports "Import failed".

What it adds, on the course page's roster card:

- **Sync with Canvas** button. Adds new students, confirms anyone who joined
  on their own with their Canvas address, merges g.-twin duplicates, and
  records who Canvas has stopped listing.
- A **"No longer on Canvas"** section at the bottom, rendered as a checkable
  worklist rather than a face grid, with a Drop button. Students are imported
  in the summer and drop through the first weeks, so this is a recurring
  chore, not an edge case.
- An **"Email set-password links"** button on the stuck section.

Drops stay professor-confirmed. Canvas going quiet about a student is not
proof they left — an expired token, an unsynced section, or a CSV-added
student all look identical — so nothing is ever dropped automatically, and
nothing is pre-ticked. Dropping sets a status and keeps their history.

`canvas_missing_since` is cleared the moment Canvas lists someone again, so a
bad token that briefly hides a section repairs itself on the next good sync.

## Seat corrections (CA-4) — needs migration 0029

**Run `supabase/migrations/0029_reassign_seat.sql` in the SQL editor.** Until
you do, the professor's reassign taps return "Seat reassignment isn't
installed on the database yet" — the student-side move works without it.

- **Students** can move themselves: tap any open seat after checking in. It's
  an `UPDATE` of the existing check-in row, never a delete, so attendance and
  any neighbor verification survive the move.
- **Professors** tap a student, then tap a seat. A free seat moves them; an
  occupied seat swaps the two students. Seating a student who hasn't checked
  in works too.

Why 0029 has to exist: `check_ins` carries a non-deferrable
`unique (session_id, seat_id)`, so two UPDATEs can never swap two students
without transiently colliding. The swap must delete one row and write it back,
and doing that from the client — three round trips, no transaction — would
destroy a student's attendance if it failed midway. `reassign_seat` does it in
one atomic statement and authorizes the caller internally, since professors
have no UPDATE policy on `check_ins`.

## Reading the check-in metrics after a class (CA-7)

The check-in path now emits one JSON line per measured operation, tagged
`[loadmetrics]`. This is how you find out what happened during a class that
froze, after it has ended.

Pull the lines from the Vercel runtime logs for the class period and grep for
the tag. Four operations are recorded:

| op | what it measures |
| --- | --- |
| `checkin` | the check-in action end to end; `code` carries the Postgres SQLSTATE on failure (`23505` seat/duplicate race, `40P01` deadlock, `55P03` lock unavailable, `53300` connections exhausted) |
| `checkin_page` | one full render of the check-in page — what a single `router.refresh()` costs |
| `realtime_down` | a student's device lost its realtime subscription and started refreshing every 5s; `code` is the transport status |
| `realtime_up` | it recovered; `ms` is how long that device spent degraded |

**What to look for.** A cluster of `realtime_down` at the moment the room
seized, followed by `checkin_page` latency climbing, is the cascading-failure
signature: the fallback poll re-renders the whole page (~11 queries) on every
device every 5 seconds, which starves the database that realtime is already
struggling with. Few or no `realtime_down` lines means the freeze is
something else, and that rules out a whole branch of the search.

Lines carry `courseId` (page renders) or `sessionId` (check-ins and realtime
reports), and deliberately carry **no** user, enrollment, or seat identifier — latency and contention are answerable without
them, and these land in a log with wider access than the database.

To turn an export into percentiles, feed the lines to `aggregateLines()` from
`src/lib/loadmetrics.ts`.

The load-test harness is `scripts/loadtest-checkin.ts`. It refuses to run
unless **both** the app URL and the Supabase project are local, because it
provisions accounts and writes check-ins into today's open session — against
the production project that would corrupt real attendance. It has not been run
yet; it needs a local Supabase to point at.

## Known items still open (deliberately)

- **Playwright end-to-end test** (roadmap TASK-059): needs a live seeded
  database to run against; write after keys are in.
- **docs/design.md** (TASK-063): visual design tokens are provisional (clean
  shadcn "nova" defaults). Run the **Design System** skill with reference
  images when you want a distinctive look; then restyle via
  `src/app/globals.css`.
- **Full pilot walkthrough** (TASK-064): the checklist above, executed against
  live Supabase.
- **CI**: `.github/workflows/ci.yml` runs typecheck/lint/tests/build on every
  push once the repo is on GitHub.
- Supabase magic-link emails use Supabase's built-in sender until you complete
  step 5 — fine for testing, upgrade before the real class.

## What's already verified

- Full production build (`npm run build`) is green; TypeScript strict passes.
- 8 unit tests pass (join codes, seat grid math, neighbor coordinates).
- Atomic seat claiming is enforced by database unique constraints (two
  students tapping the same seat: exactly one wins).
- Row-Level Security on every table; students can't see classmates' emails;
  the service-role key never reaches the browser.
