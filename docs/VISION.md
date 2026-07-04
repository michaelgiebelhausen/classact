# Vision — ClassAct

> Captured by the Product Planner skill. This file is the source of truth for
> generating product-vision.md, prd.md, and product-roadmap.md. Edit it directly
> and re-run the Product Planner to regenerate downstream documents.

**Created:** 2026-07-03
**Updated:** 2026-07-03

## Founder

- **Name:** Professor Mike Giebelhausen
- **Expertise:** Marketing professor at Clemson University (Marketing Department) — teaches Marketing Research and an AI Tools & Techniques course. Serial ed-tech founder with direct experience building in-classroom engagement technology.
- **Background:** Mike previously helped build ClassroomDJ.com and ran his own ed-tech startup very similar to this one, which failed. He carries hard-won lessons from that failure about what faculty and students actually do (versus what they say they want), and is rebuilding the concept with AI as a force multiplier to do it right this time.

## Purpose

- **Who you help:** Higher-education faculty who teach face-to-face lecture courses — primarily large-enrollment classes where students are anonymous to each other and disengaged. Students are the secondary user, reached through the faculty.
- **Problem you solve:** Faculty are drowning in classroom pain points they can't fix without more work than they'll ever do: attendance fraud (proxy check-ins via Top Hat/clickers), students surfing and shopping on laptops instead of engaging, the burden of inventing active-learning exercises, grading load, group-project free-riders, and fear of the negative student evaluations that can cost them their jobs. Existing tools ask faculty to do *more*; faculty will do almost nothing new.
- **Desired transformation:** A large lecture hall of disengaged strangers becomes a connected, participating classroom — where attendance is verified and effortless, students actually know each other, engagement is prompted automatically by AI (not by the professor), and the professor's pain shrinks while their evaluations rise. For students, an anonymous obligation becomes a place they meet people and, eventually, get hired.
- **Why you:** Mike is a practicing professor living these exact pain points every semester, and a repeat founder who has already built and failed at this once. He has both the domain scar tissue and the classroom to pilot in.

## Product

- **Name:** ClassAct
- **One-liner:** ClassAct is a lightweight in-person LMS that turns a face-to-face lecture hall into a connected, engaged classroom — starting with verified seat-map attendance and name games that get students to actually meet each other.
- **How it works:** A professor links their course (with claimed Canvas/Blackboard integration) and sets up a seat map of their room. Students activate an account via an emailed join code and build a profile with three photos (candid selfie, professional headshot, an "adventure" shot). Walking into class, a student taps their seat on a live map and confirms the identities of the peers in front, behind, and to each side — verifying attendance while forcing a real introduction. While the room fills, students play name games (memory tiles, flash cards) built from classmates' profile photos. Behavior across these activities rolls up into ClassAct Metrics, which later powers the engagement scoring and the jobs pipeline.
- **Key capabilities:**
  - Verified seat-map check-in with peer confirmation (kills proxy attendance, forces students to meet neighbors)
  - Student/professor profiles with three-photo formats and configurable icebreaker fields
  - Name games (memory tiles + flash cards) that teach the room everyone's names
  - Networking score and foundational ClassAct Metrics (points for sitting in new seats, meeting new people)
  - Course setup with claimed Canvas/Blackboard roster integration and low-friction faculty onboarding
- **Platform:** web
- **Market differentiation:** Unlike Piazza (online discussion board) or Top Hat/clickers (attendance + polling), ClassAct is built around the *in-person* classroom experience and community. It is designed from the ground up around two brutal truths: faculty will do almost nothing new, and students only care about outcomes (jobs). The AI does the work faculty won't, and the eventual jobs marketplace is the carrot that makes students tolerate — even want — the system.
- **Magic moment:** A student walks into a large lecture hall where they know no one. They tap their seat on a live map, confirm the names of the four people around them — so they've now actually met someone — and play a 30-second name game while the room fills. By week three, it's no longer a room of strangers.

## Audience

- **Primary user:** A face-to-face higher-ed professor teaching a medium-to-large lecture course (40+ students). Time-poor, proud of their existing materials, often unsophisticated with technology, and unwilling to adopt anything that adds work. Motivated by pain relief (attendance fraud, disengagement, grading, evaluations) far more than by abstract "engagement" or "learning outcomes" language.
- **Secondary users:**
  - Students — cynical, AI-averse, attention-fragmented, and largely uninterested in the material; won't like the system unless it gets them a job.
  - Employers — will later use the system to identify and interview top students based on demonstrated in-class behavior (team players, not distracted, humble, articulate).
- **Current alternatives:** Top Hat and physical clickers for attendance/polling (gameable via proxy check-in), Piazza for online discussion, Canvas/Blackboard as the system-of-record LMS (which most faculty barely use), and no-laptop policies enforced manually.
- **Frustrations:** Existing tools are gameable (proxy attendance), add faculty workload, live online rather than in the physical room, and do nothing for classroom community or student networking. They treat symptoms (take attendance) rather than the real goal (an engaged, connected room) — and none of them give students a reason to care.

## Business

- **Revenue model:** marketplace
- **90-day goal:** Ship the MVP and run ClassAct live in Mike's own Clemson class for the Fall 2026 semester as a working, dogfooded pilot. The MVP is free to use; success is a functioning product proven in a real classroom, not revenue.
- **6-month vision:** By Spring 2027, ClassAct is vetted and stable from the Fall pilot and ready to push more broadly — invited Clemson colleagues piloting it in their classes, with the next app (name games → lecture dashboard / AI think-pair-share) coming into view. Broad push with pre-created accounts targeted for Fall 2027.
- **Constraints:** Solo, non-technical founder building with AI (Claude Code); limited time as a full-time professor; budget-conscious; must comply with FERPA and treat student data ownership as a hard requirement (learning from Piazza's data-sale missteps); must work reliably with 40+ students checking in simultaneously in one room on mixed devices/networks.
- **Go-to-market:** Start in Mike's own Clemson classes (Fall 2026), expand to invited colleagues in the Clemson marketing/business school via word-of-mouth (Spring 2027), then a broad push (Fall 2027) using pre-created accounts seeded from public syllabus repositories plus emailed activation links ("we set this up for you — click to activate"). Faculty messaging leads with pain relief and anti-hype, not engagement/learning rhetoric. Long-term revenue comes from acting as a headhunter — a ~10% placement fee for connecting top students (by demonstrated in-class engagement) with employers — with a careful, student-owned-data posture and an eventual hand-off of placement to university career services.

## Brand Voice

- **Personality:** Pragmatic and anti-hype. The plain-spoken colleague who respects that you're a busy expert and just wants to make your class less painful. Confident, a little dry, zero ed-tech buzzwords, and deliberately understated about the AI under the hood.
- **Tone of voice:** Direct, practical, and honest. Sells pain relief, not transformation. Never sounds like a Silicon Valley pitch and never over-promises on AI (especially to students, who are AI-averse). Example (to faculty): "Attendance takes zero minutes and students can't fake it. That's it." Example (to students): "Tap your seat, meet the people next to you, and get on with your day." Avoid: "revolutionize engagement," "AI-powered learning transformation," "supercharge your classroom."

> Visual identity (mood, anti-patterns, design tokens) is deliberately not
> captured here — it lives in docs/design.md, generated by the Design System
> skill from image references.

## Tech Stack

- **App type:** web
- **Frontend:** Next.js + React + TypeScript + Tailwind CSS + shadcn/ui — the most AI-legible web stack, written fluently by Claude Code; one responsive codebase serves laptop (primary) and phone (in-room check-in).
- **Backend:** Next.js (built-in API routes / server actions) — no separate server to operate; frontend and backend ship as one app, simplest for a solo non-technical founder.
- **Database:** Supabase (Postgres) — relational data (students, courses, seats, profiles, scores) plus bundled file storage for the three profile photos and realtime subscriptions for the live seat map, all in one service.
- **Auth:** Supabase Auth (magic-link email) — low-friction login that fits the "click to activate" GTM; consolidated with the database and storage rather than a separate auth vendor. University SSO can be added later.
- **Payments:** None — the MVP is free; the placement-fee marketplace model is a later-phase concern, so Stripe is explicitly deferred to a future phase.
- **Analytics:** PostHog — free tier covers early classroom volume; product analytics plus session insight into how students actually use it.
- **Email:** Resend — transactional email for join codes and activation links, central to the onboarding/GTM motion; clean fit with the Next.js stack.
- **Error tracking:** Sentry — surfaces production errors before students report them, important when 40+ users hit the app at once.

## Tooling

- **Coding agent:** Claude Code
