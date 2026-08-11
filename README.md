# ClassAct

Eliminate professor pain. Create student opportunity.

ClassAct is an in-person LMS for higher ed that turns the classroom chores
everyone dreads — attendance, laptops, participation, group projects,
grading — into a single process that leaves students more connected, more
engaged, and more employable. Students check in by tapping their seat on a
live map and confirming the people around them; name games make the room
non-anonymous by week three; peer instruction, project monitoring, and
AI/peer/instructor grading carry it the rest of the term.

**Status:** Live at [classact.college](https://classact.college) — see
[HANDOFF.md](./HANDOFF.md) for the deployment runbook.

## Stack

Next.js (App Router) + React + TypeScript + Tailwind v4 + shadcn/ui ·
Supabase (Postgres, Auth magic links, Storage, Realtime) · Resend · PostHog ·
Sentry · Vercel.

## Local development

```bash
cp .env.example .env.local   # fill in Supabase keys (see HANDOFF.md § 2)
npm install --legacy-peer-deps
npm run dev                  # http://localhost:3000
```

Apply `supabase/migrations/*.sql` to your Supabase project (SQL editor, in
order) before signing in. Seed a demo classroom:

```bash
npx tsx --env-file=.env.local scripts/seed-demo.ts you@example.edu
```

## Scripts

- `npm run dev` / `npm run build` / `npm start`
- `npm run test` — Vitest unit tests
- `npm run lint` · `npm run typecheck`

## Architecture (short version)

- `src/app` — routes: marketing landing, `/login` + `/join` (magic links),
  `(app)/` authed shell: dashboard, course home, setup (seat map · roster ·
  icebreakers · invites), check-in (live seat map + neighbor verification),
  games, metrics, profile; `/onboarding` for students.
- `src/server/actions` — server actions (auth, courses, seatmap, enrollment,
  photos, check-in, games, metrics). All writes RLS-scoped; service-role only
  for membership-checked directory reads and roster import.
- `supabase/migrations` — schema, Row-Level Security, triggers (auto profile,
  verification → verified flag), private photo bucket, realtime publication.
- Correctness of the magic moment: seat claims are atomic via DB unique
  constraints — `(session_id, seat_id)` and `(session_id, enrollment_id)`.

## Planning docs

`docs/product-vision.md` (strategy/brand) · `docs/prd.md` (technical spec) ·
`docs/product-roadmap.md` (build plan + progress) · `docs/VISION.md` (source
of truth from founder intake).
