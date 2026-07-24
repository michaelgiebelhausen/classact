# BYOK + Billing — Sprint Plan

**Status:** Designed (grill-me session 2026-07-19, decisions Mike-approved).
Not yet built. Goal: open ClassAct to other professors without Mike paying
for their AI compute; collect $5/mo with a card on file.

## Decisions

1. **Two-key architecture.** A **system key** (`OPENROUTER_API_KEY`, Mike's)
   powers platform-level AI only — room-photo drafting and anything that
   enriches the shared commons. Everything inside a professor's courses
   (taste drafting, rubric emergence, baselines, submission scoring, deck
   questions) resolves **course → owner → the professor's own OpenRouter
   key**. Students never need keys; the cost boundary is the professor.
   A `founder` profile flag lets Mike's own courses fall back to the env key.
2. **Profile-level key**, one per professor, all their courses. Encrypted at
   rest (AES-256-GCM, `APP_ENCRYPTION_KEY` env secret), validated live
   against OpenRouter `GET /api/v1/key` (which also yields usage/limit for
   a "credits remaining" display), UI shows last4 only, decrypted only
   inside server actions. `professor_ai` table has NO RLS policies —
   service-role access only.
3. **Per-task model choice** on a professor AI-settings page: one main
   model + advanced per-task overrides (taste drafting / rubric emergence /
   baselines / scoring / deck questions). Dropdown populated live from
   OpenRouter `/models` via the professor's key, filtered to file-capable
   models for scoring, with real pricing shown. Baselines carry a
   "cheap model recommended" nudge (generic-on-purpose). Stored as
   `models` jsonb beside the key.
4. **Failure = pause, never surprise.** Preflight key+credit checks at
   assignment creation and analysis start; missing/broken key moves
   analysis to an `awaiting_key` state with a loud professor banner;
   students see only "starts once your professor completes setup"; the
   resumable batch machinery resumes free once fixed. Cost preview before
   runs: "~40 submissions × your scoring model ≈ $1.80".
5. **Billing ON at launch: $5/month per professor** via Stripe Checkout
   (card on file, self-serve cancel via Stripe customer portal). Enforced
   at *course creation*, not signup. Students always free. `comp` +
   `founder` profile flags bypass (one SQL statement per friendly).
   `BILLING_ENABLED` env flag turns the whole gate off without a code
   change.

## Data model sketch (migration 0015)

```
professor_ai:  profile_id (unique, FK profiles), key_ciphertext text,
               key_last4 text, models jsonb, updated_at
               -- no RLS policies: service-role only
profiles:      + founder bool default false, + comp bool default false,
               + stripe_customer_id text, + subscription_status text
assignments.state: + 'awaiting_key'
```

## Sprint tasks (roadmap Phase 7, TASK-076–082)

1. **TASK-076** — Migration 0015 + db.ts types (professor_ai, profile
   flags/stripe columns, awaiting_key state).
2. **TASK-077** — `src/lib/aicrypto.ts` (AES-256-GCM encrypt/decrypt +
   tests) and `src/server/aicreds.ts` (resolve course→professor key+models,
   founder fallback, OpenRouter key-info fetch).
3. **TASK-078** — AI settings page (`/settings/ai`): connect/validate/
   replace/remove key, live model pickers with pricing, per-task overrides,
   test-connection ping, credits-remaining display.
4. **TASK-079** — Thread credentials through `tastyai.ts` and
   `questiongen.ts` (per-professor); `roomvision.ts` stays on the system
   key. `callModel` takes `{apiKey, model}`.
5. **TASK-080** — Gating: preflight checks, `awaiting_key` pause + resume,
   professor banners, neutral student copy, pre-run cost preview.
6. **TASK-081** — Stripe: checkout session + webhook (subscription status
   sync) + customer portal link; course-creation gate honoring
   `BILLING_ENABLED`, `comp`, `founder`. Env: STRIPE_SECRET_KEY,
   STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID.
7. **TASK-082** — HANDOFF runbook (0015, generating APP_ENCRYPTION_KEY,
   Stripe product/webhook setup incl. `stripe listen` for local dev),
   roadmap/status updates, landing pricing line.

## Notes / edges

- Never log or echo key plaintext; validation errors must not include it.
- Webhooks need a public URL in production (Vercel deploy) — local dev via
  Stripe CLI forwarding; document both.
- If a professor's subscription lapses mid-semester, courses stay readable;
  the gate blocks only *new* course creation (students are never hostages).
- Mike's account: set `founder = true` in SQL right after 0015 runs.
