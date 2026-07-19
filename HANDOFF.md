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
   `0010_exercises.sql`, `0011_rooms.sql`, then `0012_schedule.sql` (order
   matters). Each should say "Success". *(0011 adds seat geometry + the
   shared room database; 0012 adds the class schedule that auto-opens
   check-in — the app queries these columns, so it breaks without them.)*
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
