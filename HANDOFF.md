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

## 5. Email — Resend — DONE

All of this is live as of 2026-08-28. Kept here because it describes how mail
works now, not because there is anything to do.

1. ✅ `classact.college` is verified at Resend. DNS shows the DKIM record at
   `resend._domainkey`, SPF `include:amazonses.com` and the feedback MX on
   `send.classact.college`, and DMARC at `p=none`.
2. ✅ `RESEND_API_KEY` is set locally and in Vercel. It is a **send-only
   restricted key** — it cannot read domains or account settings, which is
   the right shape for a key that only ever sends.
3. ✅ `EMAIL_FROM` is `ClassAct <noreply@classact.college>`.
4. ✅ **Supabase custom SMTP points at Resend.** Host `smtp.resend.com`,
   port 465, username `resend`, password = the API key.

**Two senders, and you can tell them apart in the Resend log by subject.**
The app sends invites and its own sign-in links through the Resend *API*
(`src/lib/email.ts`) — subjects "Your ClassAct sign-in link" and
"{course} is using ClassAct — join the class". Supabase sends the
`signInWithOtp` magic links through *SMTP* — subject "Your sign-in link",
from Supabase's own template. A bare "Your sign-in link" in the Resend
dashboard is the proof that custom SMTP is wired; the app never sends that
subject.

**Still worth reading before class: Supabase → Authentication → Rate
Limits → "Rate limit for sending emails".** Pointing SMTP at Resend does not
touch it; it is a separate field and it defaults to **30 per hour**. Forty
students signing in during one arrival window is exactly the shape that hits
it, and student 31 gets silence — no error in the room, nothing in Sentry.
Read the field; raise it if it is still at the default.

**What this now costs:** sign-in depends on Resend. A Resend outage or a
domain suspension takes out login, not just invites. That is the right
trade for deliverability at forty students, but it is a single point of
failure worth knowing you have.

## 6. Analytics & error tracking (5 min, optional but recommended)

- **PostHog:** posthog.com → new project → copy the project API key →
  `NEXT_PUBLIC_POSTHOG_KEY`. Events already instrumented: course_created,
  roster_imported, onboarding_completed, checkin_completed, neighbor_verified,
  game_played.
- **Sentry:** sentry.io → new Next.js project → copy the DSN →
  `NEXT_PUBLIC_SENTRY_DSN`. PII scrubbing is already configured.

Both are silent no-ops until their keys exist — nothing breaks without them.

## 7. Pilot smoke test (15 min — do this before the first real class)

Start with the one check that needs no browser at all — if the database is
behind this build, everything below will look like an empty classroom rather
than a failure:

- [ ] `curl https://classact.college/api/health` → `"status":"ok"`. Anything
      else names the migration to run.

Then use two browsers (or one normal + one incognito) so you can be professor
and student at once:

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

## Assignment instructions and points, plus Canvas identity (0033)

**Run `supabase/migrations/0033_assignment_fields.sql` BEFORE deploying** —
the assignment page selects `instructions` and `points`, and the Canvas
roster sync writes `enrollments.canvas_user_id`. Without the columns the
assignment pages 404 and the sync fails.

`instructions` is the student-facing brief. It is **not**
`settings.gradingInstructions`, which is the professor's private AI grading
criteria for ai_only assignments — similar name, opposite audience. The
create form now labels the latter "Your grading criteria" and holds it in a
`gradingCriteria` variable, so the two can't be confused in code either.

Instructions are additive: `storage_path` (the brief PDF) still works
exactly as before, and an assignment may have either, both, or neither. A
typed brief also now feeds the AI taste-file draft, so a text-only
assignment no longer drafts from the title alone.

`points` is nullable on purpose. Null means "no point value set", which is
a different fact from zero — a `default 0` would have made every existing
assignment look deliberately worthless. Nothing reads it yet: it does not
affect cut points, letters, or ranking. That is the speed-grader work.

`canvas_assignment_id`, `canvas_exported_at` and `canvas_user_id` are
identity for a future Canvas gradebook CSV export, which is spec'd but not
built. Only `canvas_user_id` is populated, by the roster sync, for free on
every resync. See `docs/canvas-assignment-fields-plan.md`.

## The app now notices when the database is behind it

No migration. Nothing to run — this is the guard that would have caught the
0036 incident below in the first minute instead of the first class.

**The failure it exists for.** Migrations here are applied by hand, so a
deploy can land before its migration. On 2026-08-28 one did, and it did not
crash: every check-in query destructures `{ data }` and ignores `error`, so
PostgREST's "column does not exist" became `data: null`, became an empty
occupants list, became a seat map showing an **empty room** in a class where
students were sitting. Nothing reached Sentry, because nothing threw. A
schema gap impersonating an empty classroom is the worst shape this can
take, because it looks like an answer.

**What happens now.** `src/lib/schemacontract.ts` lists the columns and
tables this build reads that a migration created. At boot, one cheap probe
per table (`select … limit(0)`) asks the database whether they're there:

- **Development** — the server refuses to start, printing which column is
  missing and which file to run. You cannot pull a migration-dependent
  branch and forget.
- **Production** — the same alert is logged, but the deployment keeps
  serving. A deploy that refuses to boot turns a broken check-in page into a
  broken everything, and Vercel does not roll back on its own.
- **The check-in page** — shows an explicit "the site was updated ahead of
  its database" card *instead of* the seat map. The professor gets the
  migration filename; students get told their attendance is safe and that
  their professor can fix it. Better an admission than a convincing lie
  about who is in the room.
- **`GET /api/health`** — answers with the same verdict, so you can ask from
  outside the app without signing in:

  ```
  {"ok":true,"schema":{"status":"ok"}}                              200
  {"ok":false,"schema":{"status":"behind",
    "gaps":[{"table":…,"migration":…,"detail":…}],
    "migrations":["0038_note_entries.sql"]}}                        503
  ```

  It used to return a hardcoded `{"ok": true}`, which is why the 0038 deploy
  on 2026-08-28 looked healthy for hours while the notes feature ran against
  a database that had never seen its migration. `status` is `unknown` (with
  `ok: true`, and 200) when there is no service-role key to check with — a
  developer without one has an unaskable question, not a broken deployment.

  **Nothing is wired to this endpoint yet.** Point an uptime monitor at it
  and an unapplied migration will page you, which is the intent — but it
  also means a hand-applied migration you haven't got to yet can now set off
  an alarm. Decide that on purpose. It is cheap to poll: a healthy answer is
  cached for the life of the server instance and the probe times out at 3s.

**It cannot cry wolf.** Only three error codes count as a gap: `42703` (no
such column) and `42P01` (no such table), Postgres stating a fact, plus
PostgREST's own `PGRST205` — a missing *table* never reaches Postgres at
all, so watching only for 42P01 left every table-level contract entry
undetectable. A timeout, a
dropped connection, a missing service-role key: all reported healthy on
purpose, because blanking a working seat map mid-class over a network blip
would be worse than the bug being guarded. A healthy answer is cached for
the life of the server instance; an unhealthy one is re-checked every 60s,
so the banner clears itself about a minute after you run the migration —
no redeploy.

**When you add a migration that adds a column the code reads, add it to
`SCHEMA_CONTRACT`.** A stale entry costs one wrong log line; a missing one
costs an empty classroom.

## Transcripts, syllabus, and Ask the TA (0040)

**Run `supabase/migrations/0040_course_materials.sql` BEFORE deploying.** It
adds transcript/syllabus columns the new code selects, the private
`course-materials` bucket, and the `ta_messages` table. The schema guard
knows about all three, so an unmigrated database shows the "database is
behind" card rather than failing silently — but run it first anyway.

**What shipped.**
- Professors attach a lecture transcript (.txt/.md/.vtt, ≤2MB — text only on
  purpose; every recorder exports text) per deck on the Slides tab. VTT is
  flattened to prose at upload.
- A Materials tab in course setup holds the syllabus upload (.pdf/.txt/.md)
  and the "Students can download transcripts" toggle (default ON).
- Students get Transcript download buttons on the Notes page and the live
  Follow Along view. **The toggle is enforced server-side**: the bucket has
  no member-read policy and links are admin-minted only while the toggle is
  on. Flipping it off leaves already-minted links alive for up to an hour.
- **Ask the TA** (sidebar: "Ask TA", `/course/{id}/ta`): a chat grounded
  ONLY in course materials — syllabus, assignment instructions, transcripts,
  and slide/reading text — with bracketed citations, refusing questions the
  materials don't cover. Threads are private per member (RLS author-only, no
  professor read path, same principle as notes).
- **It runs on the professor's OpenRouter key only** — no platform subsidy.
  No key = students see "ask your professor to enable"; the professor sees a
  link to AI Settings. Slide decks and PDF readings/syllabi need a one-time
  "Index materials" pass (button on the TA page, professor-driven, on their
  key); transcripts and text syllabi are readable instantly.
- Caps: 3 questions/min burst, 30/day per person, 400/day per course — the
  daily caps are counted from `ta_messages` in the database, so they survive
  deploys.

**Smoke test (5 minutes).** As professor: upload a syllabus (.txt is
fastest), attach a .vtt or .txt transcript to a deck, open Ask TA and ask a
syllabus question — expect an answer citing [Syllabus]. Ask something not in
any material — expect "I don't see this in the course materials." As a
student: Notes page shows Transcript next to Slides; flip the toggle off in
Materials and reload — the button is gone; the TA still answers transcript
questions either way.

## Notes students can actually keep (0038)

**Run `supabase/migrations/0038_note_entries.sql` BEFORE deploying.** Deploy
order is safe in the sense that nothing breaks either way — the old build
writes freeform blobs the new table ignores, and the new build's reads simply
come back empty — but running it first is what keeps a student from typing a
note and being told "Couldn't save that note." The schema guard lists
`lecture_note_entries` in `SCHEMA_CONTRACT`, so an unmigrated database
announces itself at boot rather than quietly showing an empty notebook.

**Re-run the import if a lecture was live during the window.** The migration
ends with an `insert … select` that imports each old freeform blob as one
unstamped entry. It is idempotent — it skips any student who already has an
unstamped entry for that lecture — so if class was in session between running
the migration and the deploy landing, paste that one statement again
afterwards and it will catch the stragglers without duplicating anyone.

**Why this exists.** Students were typing notes into ClassAct and then pasting
them into a Word document, because nothing told them what became of the text.
The text was always being saved; it was simply unreachable the moment the
lecture ended, which from the student's side is indistinguishable from being
thrown away.

**What this ships.**

- **Notes are a running log, not a box.** Each thought is committed with Enter
  (Shift+Enter for a new line) and stamped with the slide that was on screen
  when they *started typing it* — not wherever the professor has moved on to
  by the time they finish. Entries can be edited or deleted afterwards.
- **A Notes page per course**, next to Follow Along in the sidebar. Every
  lecture's notes, grouped and dated, still private.
- **Export that survives leaving.** Download as a Markdown file, or email it
  anywhere — their own inbox, or an assistant that reads Markdown. The email
  carries the notes as both the body and a `.md` attachment. Limit is 5 sends
  per hour per person, in memory, so it resets on redeploy (same tradeoff as
  invites).
- **A draft is hard to lose.** Navigating away in-app commits it; closing the
  tab mirrors it to `localStorage` and it comes back on the next visit.

**Privacy is enforced by RLS, not by the UI.** The only policy on
`lecture_note_entries` is the author's own, copied word for word from the old
`lecture_notes` policy. The professor has no read path — the Notes page shows
them a card saying exactly that. This matters more than it looks: a student
who suspects the professor can read their notes keeps the real thinking
somewhere else, which is the behavior this whole change exists to end.

**`lecture_notes` is gone as of 0039.** The import was confirmed against
production on 2026-08-28 — 24 non-empty blobs, 24 imported — so the table was
dropped. Run `supabase/migrations/0039_drop_lecture_notes.sql` in the SQL
editor; it re-counts before dropping and refuses if anything is unimported,
naming the fix (re-run the `insert…select` at the bottom of 0038). Deploy
order does not matter: no code has read or written that table since 0038
shipped. It does, however, foreclose rolling back to a build older than 0038 —
that code writes notes to a table that no longer exists. The notes themselves
are safe in `lecture_note_entries`; a rollback would stop note-taking, not
lose it.

**Smoke test (3 minutes).** Start a lecture, open the student view, type a
note and press Enter — it appears with a slide badge. Advance the deck and
add another; the badges differ. Reload: both are still there. Open Notes from
the sidebar, download the `.md`, and confirm the slide headings. Send one
email to yourself. As the professor, open the same course's Notes page and
confirm you see the privacy card and no notes.

## The professor's order, and what it's worth (0037)

**Run `supabase/migrations/0037_speed_grader.sql` BEFORE deploying.** NOT
deploy-order safe: the grading cockpit and the student report select
`rankings.final_rank` and `rankings.points_awarded`, and the taste editor
selects `taste_files.body`. Deployed code against an unmigrated database
fails those pages with a 42703. The schema guard above catches it at boot in
development and shows the "database is behind" card in production, but the
fix is the same — run the migration, reload, no redeploy.

**What this ships.** Grading finally ends in a number the professor chose:

- **A ranked list, not just a histogram.** The cockpit shows every submission
  in order, best at top. Click a row to read the work with its AI summary and
  theme scores beside it — that's the "speed" in speed grader.
- **Cut points became lines between rows.** A band is a slice of the *list*
  now, not of the 0–100 score axis, so it survives the professor dragging
  someone to a new position. Each line carries a label and a value.
- **Drag to reorder, after peer review closes.** When the peer window closes
  the model's order *materializes* into `final_rank` — from then on it is the
  professor's list, and no recompute touches it. Before that, the order still
  refines as votes arrive. A professor comparison after materialization is a
  local move (the loser drops just below the winner), not a global refit.
- **Points.** `assignments.points` finally does something. Stepped mode gives
  every row in a band the band's value ("only 4s and 5s, no 4.5s"); linear
  mode interpolates across the band's rows up to the next band, with rank 1
  earning full marks. Values are in the assignment's own scale — a percent
  grader sets points to 100.
- **Taste files are prose.** One box: "What makes this assignment good?" —
  dictated or pasted, no grid. The professor writes one too (private, on the
  assignment form), which joins the rubric corpus tagged `[PROFESSOR]` and
  *is* the rubric in ai_only mode.

**What the migration did to existing data.** Old `settings.cutPoints` letters
became band labels with no values attached, on both assignments and course
defaults — so an assignment mid-flight keeps the bands it had, and grading
without point values still works exactly as before. Where the *lines* fall is
not backfilled: it depends on the live score distribution, so the app derives
it from the old thresholds on first render and saves it on the first change.
Any `settings.gradingInstructions` became the professor's taste file row.
Taste files written in the old grid keep their criteria and are read back as
prose — nothing was converted, nothing was lost.

**Smoke test (3 minutes).** Open an already-published assignment: the student
report reads as before. Open one mid-flight: the list appears in ranked order
with the old letters as band labels. Drag a line, save, and the publish
preview shows the points each student would earn.

## Neighbors can say no, and the professor can say yes (0036)

**Run `supabase/migrations/0036_neighbor_denials.sql` BEFORE deploying.** This
one is NOT deploy-order safe: the check-in page now selects
`check_ins.denied_count` and `check_ins.professor_confirmed_at`, so deployed
code against an unmigrated database fails the page load with a 42703
(column does not exist); the professor's "Confirm attendance" button returns
"isn't installed on the database yet — run migration 0036" (42883) and the
student's "Report it" button says the same (42P01). Run the migration first
and none of those can appear.

**What this ships.** The neighbor-confirmation mechanic finally became
visible in class:

- **Rings on the map, every screen including the projection.** Green =
  someone vouched (a neighbor, or you). Red = checked in, nobody has
  confirmed them yet. Amber = nobody is sitting adjacent, so peer
  confirmation is impossible — early arrivers aren't shamed. Pulsing red =
  a neighbor pressed "**{Name} is not in the seat to my left**", which is
  the live signature of a proxy check-in. Rings are deliberately public:
  the social pressure is the mechanism, and someone checking in from home
  can't see the projected screen anyway.
- **Hover (or tap) a seat → action card**: big photo, status, **Confirm
  attendance** (turns the ring green, resolves any denial, does NOT count
  toward people-met) and **Free this seat** (the old tap behavior, now
  behind a deliberate step instead of firing on a stray tap).
- **Introduce once, confirm always.** The first time a pair are EVER
  neighbors, the student card shows the full introduction (photo, an
  icebreaker answer, "Introduce yourself"). Every later class with the same
  person collapses to one tap: "Still your row: Alex, Priya? → Confirm
  all 2."
- **The social/quiet boundary is the scheduled start, sharp.** Before it,
  a course-wide toast taps seated students on the shoulder — "Alex just sat
  down to your left — say hi!" with a one-tap confirm — anywhere in the
  course app, including the name games. From the scheduled minute on:
  no toasts, no "introduce yourself"; latecomers are confirmed silently
  from the card. (No schedule set → the window is opened_at + 15 minutes.)

**What the migration replaces (not just adds):** `handle_seat_verification`
(now fires on INSERT OR UPDATE and resolves denials — required, or a
mis-tapped denial could never be cleared by re-confirming) and
`reassign_seat` (its swap now carries `professor_confirmed_at`; without this
a swap silently stripped your confirmation). `seat_denials` is deliberately
NOT added to the realtime publication — denials reach clients as the
trigger's update to `check_ins`, which is already published.

**It also fixes a real bug:** no `FOR DELETE` policy on `check_ins` existed
in any migration, so the professor's "free this seat" was deleting **zero
rows** through RLS while toasting success — the seat stayed occupied on
everyone else's screen. 0036 adds `checkins_delete_professor`. To check
whether a hand-applied policy already existed, run in the SQL editor:
`select policyname from pg_policies where tablename = 'check_ins';` — either
way the migration is idempotent. Two client-side realtime bugs rode along:
freed seats now disappear from other students' maps without a reload, and a
student who moves seats no longer shows up in two places.

**The database half is automated.** `npx tsx --env-file=.env.local
scripts/smoketest-neighbors.ts` builds a throwaway course, exercises all
eighteen behaviours (the triggers, the deny/confirm invariant the ring
precedence rests on, the professor RPC's authorization, and the RLS
policies), and deletes everything including the synthetic users. It is safe
against production — every write is scoped to ids it created, cleanup runs
on SIGINT as well as on failure, and a sweep at startup reclaims anything a
killed run stranded. Run it after any change to 0036's triggers.

One thing a green run does NOT prove: nothing in the database validates
`relation` against the room's geometry. Adjacency is enforced only by the
server actions, so do not read a pass as "a student cannot deny someone
across the room."

**Smoke test, two browsers (~3 min) — still worth doing by hand,** because
none of the above touches the browser: student checks in → red ring on the
projected map within ~2s. Second student sits adjacent → first student gets
the say-hi toast (before the scheduled start) — try it from the games page.
Toast's "They're here" → both rings green, live. "Report it" from the card →
pulsing ring on your map; hover → "Confirm attendance" → green, and the
student's people-met count did NOT move. Free a seat → it empties on the
student's screen without a reload.

## Nobody declares a role any more (0035)

**Run `supabase/migrations/0035_membership_is_the_role.sql`.** Deploy-order
safe in either direction: the migration only stops `handle_new_user()` reading
a role out of sign-up metadata, and the app has already stopped sending one.
Run it late and a new sign-up gets a stale `profiles.role` value that nothing
reads.

**What was wrong.** The sign-up form's "I'm signing up as…" toggle defaulted
to **A professor**. Anyone who typed an email and a password and pressed the
only button on the form was written into `profiles.role` as a professor
without ever answering the question. That is the whole of the "students
somehow made themselves professors" mystery — nobody chose it, the answer was
pre-filled. A professor in the AI Tools class hit the same trap from the other
side: he answered honestly, and because the flag is global it made him a
professor in a class he was *attending*.

**Nothing was ever exposed.** Every permission in the app already gated on
`course.professor_id === profile.id`, per course. The global role granted
access to no one else's data; what it decided was which half of the app you
were shown. That is why being wrong about it stranded people rather than
leaking anything.

**What it is now.** The role is derived, per course, from the two records that
were always the truth: you are the professor of a course iff
`courses.professor_id` is you, and a student of one iff you hold a non-dropped
enrollment. Both can be true of the same person in different courses. Nothing
is declared, so nothing can be declared wrong. See `src/lib/membership.ts`.

- The sign-up role toggle is gone. Sign-up asks for an email and a password.
- `/dashboard` shows **both** sections — "Courses I teach" and "Classes I'm
  in" — and whichever you don't have yet is offered as a link.
- An account belonging to nothing gets a two-door chooser ("I am a student…"
  / "I am a professor…"). The answer is **not stored**; the next thing you do
  makes it true. A wrong tap costs a Back button.
- Onboarding is now owed once you hold an enrollment, not because you aren't
  flagged a professor. A professor attending a colleague's class is correctly
  onboarded for it; one building their first course never sees it.
- AI settings and Canvas settings gate on owning a course.
- `becomeProfessor()`, `becomeStudent()`, both buttons, and
  `src/lib/rolechange.ts` are deleted — they existed only to repair the flag.

**`profiles.role` is left in the table and left alone**, carrying whatever
values it already had, including every wrong one. Nothing reads it; the
migration comments the column as inert. Dropping it is a later migration, once
a semester has passed without anything reaching for it — a live class is the
wrong place to discover a reference we missed.

**One open note:** with no role, `/course/new` is reachable by anyone, and the
thing that makes a mis-tap cost money instead of nothing is the billing gate —
which is off while `BILLING_ENABLED` is not `"true"`. Until it's on, a student
who taps the professor door can create a junk course (harmless: RLS-scoped to
them, no students, and the dashboard still shows their classes so they are
never stranded). The chooser's copy adapts and does not quote a price that
isn't being charged.

## The user.md file on a profile (0034)

**Run `supabase/migrations/0034_profile_documents.sql`.** Unlike 0030–0032
this one is deploy-order safe: without the table the profile page still
renders ("Nothing uploaded yet") and only an upload fails.

Any account — student or professor — can attach one Markdown file to their
profile from Profile → Your file. Uploading again replaces it; there is no
in-app editor, so the copy on their machine stays the original. Markdown
only, 64 KB, enforced in the browser, in the server action, and by a CHECK
constraint.

Its own table rather than a column on `profiles`, because `getProfile()` does
`select("*")` and runs on nearly every authenticated page — a 64 KB column
there would ride along on every check-in render, for every student, all class.

**Currently owner-only under RLS.** Nobody but the person who uploaded it can
read it, including their professor. That is deliberate until it is decided who
should: widening access later is a policy change, narrowing it after the fact
is an apology.

## A student's school email vs their login (0032)

**Run `supabase/migrations/0032_school_email.sql` BEFORE deploying** — the
roster query selects `profiles.school_email`, and without the column the whole
staged roster fails.

Canvas reports one address per student. Students sign in with whatever they
like. `school_email` records the first as an attribute of the person rather
than as their credential, so a student signing in as
`tpallotta17@gmail.com` is still recognised as `tpallot@clemson.edu` on the
Canvas roster and reads as confirmed.

`school_email_verified_at` exists and is deliberately **not enforced**: these
are one professor's own students and matches are made by hand by someone who
knows them. When that stops being true, requiring a non-null value is the
entire change — no migration, no backfill. The unique index does apply now:
one school address cannot be claimed by two people, since that is the whole
identity claim.

Claiming an address is still matched against the row it is claimed for, so a
claim can never hand anyone somebody else's roster place.

## Founder-only tools

Three controls destroy things rather than re-arranging a roster, and they are
gated on `profiles.founder`: **Remove duplicate**, **Reset** (a stuck
student's login), and **Match to Canvas row**.

They exist because the developer is currently also the professor, fixing live
data by hand during an intense trial. They are not things an ordinary
professor should be able to do: a professor manages a roster — drop, block,
invite, approve — and every one of those is reversible. Deleting a student's
account is not, and nobody should hold that over a student because they
happen to teach them.

The server check is the real gate; the buttons are also hidden, because a
control that exists and refuses is worse than no control. The code is kept
rather than removed, so the decision to drop it outright can be made when the
developer is no longer the only user.

**Set the flag on any account that needs them:**

```sql
update profiles set founder = true
 where id = (select id from auth.users where email = 'you@university.edu');
```

Note this flag also routes course AI onto the system OpenRouter key (step 2).

## Resolving a duplicate student

A student who signs in with their university Google account gets a second auth
user and a second enrolment: `name@g.clemson.edu` beside the `name@clemson.edu`
Canvas holds. They usually reach their real account later and do all their work
there, leaving the shadow with a few icebreaker answers and nothing else.

**Remove duplicate** on that section deletes the spare row and the unused login
behind it. The real row — name, photo, attendance — is untouched. The login is
only deleted once it owns nothing anywhere; otherwise the student would be
signing in to an account that can't reach any class, and the next use of the
course code would rebuild the shadow.

It refuses two cases rather than guessing: no surviving twin (this is their
only enrolment, not a duplicate), and any check-in on the row being removed.
That second guard matters because 22 tables cascade-delete off `enrollments` —
the one duplicate that *does* hold attendance is exactly the row where the
student did their attending, and it needs doing by hand.

## The roster sections, and what each one's button does

Sections are named for the student's *situation*, and each carries the one fix
that situation needs. In order:

Sections run in the order they should be worked: everything with something
owed first, settled groups after, departures last.

| Section | What it means | The fix |
| --- | --- | --- |
| Confirmed their email, never got signed in | Their sign-up link only worked in the browser that requested it | **Reset** (in person) or email a set-password link |
| Have a ClassAct account, haven't added the class | They can sign in; they never joined this course | **Email them the join code** |
| Their invite bounced | The address rejects our mail | Fix it in Setup |
| From Canvas, not yet signed in | On the roster, no account behind them — they can't check in and nothing has told them | **Email them an invite** |
| The same person, twice | A g.clemson shadow row beside their real Canvas row | **Remove duplicate** |
| In the class, but not through Canvas | Approved, on their own address or never on Canvas — an auditor, or added by hand | Nothing owed; click a Canvas face beneath them to match |
| Imported from Canvas, confirmed with Canvas email | Nothing to do | — |
| No longer on Canvas | Canvas listed them once, last sync didn't | Tick and Drop |

Every section shows faces. The professor recognises the student in front of
them long before they parse an address.

**Duplicates (`the same person, twice`)**: created when a student signs in
with their university Google account (`name@g.clemson.edu`) while Canvas holds
`name@clemson.edu`. The sync's alias matcher marks both rows as seen, so the
shadow used to read as "Confirmed from Canvas" — nameless, faceless, and
apparently fully set up. The shadow is identified as the row whose *name* is
an address: `/auth/join` names a row after the address when it has nothing
better, while a Canvas import always carries the name Canvas holds, so the row
with the student's real name and photo is always the one kept.

There is deliberately **no drop button** on that section. Both rows have real
accounts, and the check-ins are split across them — dropping one takes its
attendance with it. Merging is the correct fix and is still to be built.

## Students who joined but can't check in (approve them)

`/auth/join` parks anyone not on the imported roster in a **pending** row —
profile linked, `status = 'invited'` — for the professor to approve. Nothing
surfaced that, and `checkIn` requires `status = 'active'`, so those students
signed up, joined, and were turned away at the seat map with "You're not on
this course's active roster yet". They had no idea anything was wrong, which
is worse than being plainly locked out.

They now appear in a red panel at the top of **Joined, but not through
Canvas**, with Approve per student and Approve all. Clear it before class.

Where they came from: students locked out of their university address by the
PKCE trap signed up with a personal one instead and joined by code. The
workaround left them half-enrolled — a dead Canvas row plus a working personal
account. Approving lets them attend; merging the two rows is the proper fix
and is still outstanding.

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
- Supabase's auth email rate limit (Authentication → Rate Limits) has not been
  read since custom SMTP was wired. Default is 30/hour; forty students check
  in inside one window. See step 5.

## What's already verified

- Full production build (`npm run build`) is green; TypeScript strict passes.
- 647 unit and component tests pass across 49 files (`npx vitest run`). They
  cover the pure logic the app leans on hardest: seat rings and neighbor
  adjacency, presenter navigation, grading bands and ranked order, the
  schema contract, auth-callback handling, and the health verdict. What they
  do **not** cover is anything needing a browser, a projector, or two people
  — realtime sync, BroadcastChannel, and every latency question.
- Atomic seat claiming is enforced by database unique constraints (two
  students tapping the same seat: exactly one wins).
- Row-Level Security on every table; students can't see classmates' emails;
  the service-role key never reaches the browser.
