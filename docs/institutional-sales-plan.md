# Institutional sales via the BYOK nudge — captured idea, deliberately unbuilt

**Status: idea captured 2026-08-29. Nothing built, on purpose.** There is no
institutional tier to sell yet (`BILLING_ENABLED` is off; `docs/byok-billing-plan.md`
is a plan, not a product), so shipping this now would advertise something that
doesn't exist. Build it when the virtual TA ships or when the first real
institutional interest appears — whichever comes first.

## The idea

Every place ClassAct asks a professor to paste their own OpenRouter API key is
the exact moment they're most receptive to "…or your university could pay for
this." Add a nudge at that moment encouraging them to contact their institution
about purchasing access — turning cost-averse professors into an inbound
institutional sales channel. Faculty champions are how most edtech gets into
universities (Piazza, Gradescope, Top Hat all spread this way), and the
incentive alignment is real: it's the professor's own money on the line, so
they do the internal selling.

## Where it lives

Every BYOK key-entry surface:

- **Today:** the OpenRouter card in
  `src/components/features/settings/AiSettingsForm.tsx` — specifically its
  "Not connected" state, where the professor is deciding whether to pay.
- **Future:** the virtual TA's key prompt, when that feature exists.

Build it once as a small shared component (working name `InstitutionalNudge`)
taking the surface name as a prop, so the copy, mailto template, and analytics
event stay consistent everywhere it appears. Keep it a distinct visual element
(one-line callout under the key input), not more paragraph text — the grading
card's description is already long.

## Mechanics — what makes it a pipeline instead of just copy

A sentence saying "ask your university to pay" produces motion nobody can see.
The version that builds a pipeline:

1. **CTA** next to the key input:
   *"Don't want to pay out of pocket? See if your institution will cover it."*
2. **Pre-written mailto** the professor sends to their department chair,
   Center for Teaching & Learning, or IT procurement contact — with
   ClassAct (Mike) as **cc or reply-to**. The cc is the whole game: it
   converts an anonymous professor into a named lead at a named institution,
   delivered with a warm internal intro.
3. **PostHog event** (hand-curated, e.g. `institutional_nudge_clicked`) so
   warming schools are visible in analytics. Consistent with the existing
   write-only, curated-events PostHog setup — no new capture surface.

### Draft email template

> Subject: AI teaching tool for [department] — institutional access inquiry
>
> Hi [name],
>
> I've been using ClassAct in my courses — it handles seating, peer-instruction
> polling, attendance, and AI-assisted grading. The AI features (grading
> assistance, and soon a virtual TA) currently run on per-instructor API
> credits that faculty pay out of pocket.
>
> I'd like the university to look into institutional access so faculty here
> don't each need to set up and fund their own AI accounts. The ClassAct team
> (cc'd) can walk through what an institutional arrangement would cover —
> centralized billing, no per-professor API setup, and access for any
> instructor in the [department/college].
>
> Could we set up a short call?
>
> Thanks,
> [professor]

Note the framing: the professor asks their own institution; ClassAct is the
cc'd vendor, not the sender.

## Preconditions before activating

- **Copy must say "contact us about institutional access."** Never imply a
  subscription product or sign-up flow exists until one does. The first
  serious inquiry is the trigger to actually design institutional pricing —
  classic "sell it to spec it."
- **Migration 0024 (billing-column guard) must be applied before
  `BILLING_ENABLED` is ever turned on**, or users can self-grant
  subscriptions. See `docs/byok-billing-plan.md`.

## Honest caution

The professors most likely to click this are the least likely to hold budget
authority, and university procurement cycles are long. Expect low conversion
and long lead times — fine for a zero-marginal-cost channel, but never let it
gate or degrade the BYOK experience. BYOK stays the primary, working path;
the nudge is a free option on top.
