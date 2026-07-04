# Product Vision — ClassAct

## 1. Vision & Mission

### Vision Statement

Every face-to-face college classroom becomes a place where students actually know each other, show up engaged, and leave with relationships and opportunities — not just a grade.

### Mission Statement

ClassAct makes the in-person classroom work better by handling the things professors hate (fraud-proof attendance, disengagement, busywork) and giving students the one thing they actually want (people to know and jobs to land) — with the AI doing the work faculty will never do themselves.

### Founder's Why

Mike Giebelhausen is a marketing professor at Clemson who lives these problems every single week. He watches students file into a lecture hall, sit next to strangers they'll never speak to, open a laptop, and shop for the next fifty minutes. He has taken attendance with clickers and watched students click in from bed. He has spent Sunday nights inventing discussion questions that half the room ignores. This isn't a market he studied — it's the room he stands in front of.

He has also already built this once. ClassroomDJ.com and a subsequent startup taught him the lessons that kill ed-tech companies: faculty will not change their behavior, students resent anything that feels like surveillance or extra work, and grand talk about "engagement" and "learning outcomes" persuades no one who actually teaches. Those failures are the most valuable asset in this venture. They're why ClassAct leads with pain relief instead of pedagogy, why it asks faculty to do almost nothing, and why it dangles jobs in front of students instead of lecturing them about participation.

What's different this time is AI. The reason ClassAct couldn't work before is that it required faculty labor the founders couldn't extract. AI removes that constraint — it can generate the questions, learn the names, summarize the feedback, and run the room. Mike is rebuilding the idea at the exact moment the missing piece finally exists, with a real classroom to prove it in.

### Core Values

- **Faculty do nothing new.** Every feature is measured against one question: does this add work to a professor's week? If the answer is yes, the AI has to absorb that work, or the feature doesn't ship. The product's job is to remove faculty labor, never add it.
- **Students own their data, always.** The last version of this idea (and Piazza before it) got burned selling access to students. ClassAct treats student data ownership and consent as non-negotiable — students opt into everything that leaves the classroom, especially anything tied to jobs. This isn't just ethics; it's the moat that keeps universities from treating us as a threat.
- **Sell the aspirin, not the vitamin.** We describe what breaks and how we stop it, in plain language. "Students can't fake attendance" beats "boost engagement." We resist the industry reflex to dress everything up as transformation.
- **Understate the AI.** Students are AI-averse and faculty are AI-skeptical. The intelligence runs quietly under the hood. We earn trust by working, not by branding ourselves as "AI-powered."
- **The room is the point.** ClassAct is about the physical, in-person classroom — who's sitting where, who's meeting whom. Anything that could just as easily be an online forum is not our product.

### Strategic Pillars

- **Pain relief is the wedge; jobs are the engine.** Faculty adopt because it kills their pain. Students tolerate it because it can get them hired. Every roadmap decision serves one of these two motivations — never abstract learning theory.
- **Ship the smallest thing that makes a room less anonymous.** The first version proves classroom community with the least infrastructure. Resist building the ten-app platform before the one app earns its keep.
- **Claim the integration, defer the plumbing.** Faculty demand "does it work with Canvas/Blackboard?" — so we answer yes and support it through the simplest path (roster import) long before we build deep API integration. Perception of integration matters more early than the integration itself.
- **Design for the skeptic, not the enthusiast.** Assume the professor is unsophisticated with tech and the student is looking for a reason to hate it. If it works for them, it works for everyone.

### Success Looks Like

It's December 2026. ClassAct has run all semester in Mike's Clemson marketing course. Students walk in, tap their seat, confirm the four people around them, and play a name game while the room fills — and by now they do it without thinking. Attendance is verified and took zero minutes of class time. Mike knows his students' names by week three, and so do they. When he mentions the app to colleagues in the business school over coffee, two of them ask if they can use it next semester. The founder has a working product, real usage data from a live classroom, a fraud-proof attendance story that sells itself, and a short list of Spring pilot volunteers — the foundation for the broader push in Fall 2027.

## 2. User Research

### Primary Persona

**Professor David Reeves, 52, tenured associate professor teaching a 90-person intro business course.** David has taught for twenty years and is genuinely good at it — his slides are refined, his lectures well-paced. He is not good with technology and has no interest in becoming good with it. He uses Canvas only because the university forces him to, and barely. His daily reality around the problem: he loses the first several minutes of class to attendance he knows is partly fake, he watches the back three rows shop and scroll, and every few years a batch of mediocre evaluations makes him quietly nervous about his standing. He currently copes by giving up on attendance accuracy, occasionally announcing a no-laptop policy he can't enforce, and grinding out discussion questions he's not sure land. Emotionally, he's proud but weary, and deeply allergic to being sold "innovation." He would switch to something new only if a trusted colleague showed it to him working, it required almost nothing from him, and it visibly reduced a pain he actually feels. He will abandon anything that adds a single recurring chore to his week.

### Secondary Personas

- **Maya, 20, sophomore, cynical and career-focused.** Maya sits in David's class mostly on her phone. She's not going to love ClassAct and doesn't want another app tracking her. The only thing that flips her: the credible possibility that showing up and engaging leads to interviews and a job. She's the swing user — win her and the network effect works; lose her and the room stays dead.
- **Employers / campus recruiters (future).** Recruiters and hiring managers who want a better signal than GPA — students who show up, collaborate well, and aren't glued to their phones. They're not in the MVP, but every early data decision should keep this future door open (with student consent as the gate).
- **University administration (future kingmaker/threat).** Deans, career services, and IT. They can bless ClassAct as an official tool or kill it over data-privacy and FERPA concerns. Not a user yet, but the reason "students own their data" is a value and not a footnote.

### Jobs To Be Done

- **Functional (faculty):** "When class starts, I need attendance recorded accurately without spending class time or getting cheated, so I can just teach." "When I want the room engaged, I need it to happen without me inventing and running the activity."
- **Functional (student):** "When I walk into a class of strangers, I need a low-effort way to actually meet a few people." "When I'm about to graduate, I need my effort in class to translate into job opportunities."
- **Emotional (faculty):** "I want to feel in command of my room again, not like I'm losing a war against laptops." "I want to stop worrying that a bad evaluation cycle threatens my job."
- **Emotional (student):** "I want to feel less alone and anonymous in a giant lecture hall." "I want to feel like my time here is buying me a future, not just a transcript."
- **Social (faculty):** "I want to be seen by colleagues as someone whose classes are lively and well-run." **Social (student):** "I want to be recognized as someone worth knowing — and worth hiring."

### Pain Points

1. **Attendance fraud (high severity, every class session).** Proxy check-ins via clickers/Top Hat, remote logins, friends carrying two clickers. Professors know it's happening and have largely given up. Consequence: attendance data is meaningless and any participation grade tied to it is unfair. ClassAct's seat-map + peer verification attacks this head-on and is the single most demoable win.
2. **Disengagement / laptop surfing (high severity, continuous).** Students shopping and watching video instead of following the lecture. Current coping — no-laptop policies — is unenforceable and drags faculty into accommodation fights. High emotional cost for faculty.
3. **The activity-creation burden (medium-high, weekly).** Inventing think-pair-share questions and active-learning exercises is real work most faculty won't do. This is deferred past the MVP, but it's the pain the AI is uniquely built to erase.
4. **Grading load, especially group projects (high, but complex).** The number-one pain, but the hardest to solve well and full of free-rider dynamics. Deliberately out of the MVP.
5. **Negative evaluations (medium frequency, high stakes).** Surfaces at semester end, but can affect tenure and contracts. A secondary selling point ("students enjoy the class more → better evals"), not a core MVP claim.
6. **Anonymity for students (medium, chronic).** Real but low-urgency for the student — which is exactly why it can't be the thing we sell *to students*. It's a benefit faculty appreciate and the byproduct of the check-in mechanic.

### Current Alternatives & Competitive Landscape

- **Top Hat / physical clickers.** What they do well: established, integrated with grading, familiar. Where they fall short: trivially gameable (the core failure ClassAct exploits), online-first, nothing for community or networking. Switching cost: low — faculty already resent them.
- **Piazza.** Does well: Q&A and discussion at scale. Falls short: purely online, no in-room presence, and its data-monetization history is a cautionary tale ClassAct explicitly avoids.
- **Canvas / Blackboard.** Does well: system of record for rosters and grades. Falls short: most faculty barely use it; it's administrative plumbing, not a classroom experience. ClassAct integrates *with* it (claimed early via roster import) rather than competing.
- **"Do nothing."** The real competitor. Most professors just accept the broken status quo. Beating "do nothing" requires the switch to feel effortless and the payoff to be immediate — which is why onboarding friction is an existential concern, not a UX nicety.

### Key Assumptions to Validate

- **We assume peer verification actually stops attendance fraud** because students won't vouch for absent neighbors. To validate: run it live in Mike's class and measure verified vs. claimed attendance; watch for collusion patterns (whole rows covering for each other).
- **We assume the seat-map + verification flow takes <60 seconds and won't jam** when 40–90 students hit it simultaneously on classroom wifi. To validate: load-test concurrent check-in; pilot in a real full room, not a demo.
- **We assume students will complete a profile with three photos** despite privacy wariness. To validate: measure profile completion rate in the pilot; test whether making it optional/incremental raises completion.
- **We assume name games are compelling enough** that students play while waiting rather than defaulting to their phones. To validate: measure name-game engagement and whether name recognition actually improves (quiz students).
- **We assume faculty will do the one-time seat-map setup** even though they resist all setup. To validate: watch how Mike sets it up; if the photo/describe-the-room flow takes more than a few minutes, it's too much.
- **We assume "verified attendance" alone is a strong enough hook** to get a second professor to adopt without the jobs engine existing yet. To validate: pitch the MVP to 2–3 colleagues and see if the attendance story sells on its own.
- **We assume students will tolerate the app now for a jobs payoff that doesn't exist yet.** This is the riskiest bet. To validate: gauge whether the *promise* of the jobs layer changes student attitude, and don't over-index on student enthusiasm during the attendance-only phase.
- **We assume FERPA/data-privacy won't block a single-professor pilot.** To validate: confirm with Clemson what's permissible for Mike's own class before broad rollout; treat the broad-push phase as the real compliance gate.

### User Journey Map

**Awareness:** A professor hears about ClassAct from Mike (or, later, receives a "we already set this up for your class — click to activate" email). Emotion: mild skepticism, "another tool." Friction: any hint of setup work.

**Consideration:** They see the one thing that lands — "students physically can't fake attendance, and it costs you zero class time." Emotion: cautious interest. Friction: fear that it's complicated or that students will revolt.

**First use (faculty):** They create a course, get a join code, and set up the room by snapping a photo or describing the layout. Emotion: relief if it's fast, abandonment if it's not. This step must be near-trivial.

**First use (student):** Gets the join code, activates via a magic link, builds a profile with three photos and a couple of icebreaker answers. Emotion: wary. Friction: photo requests, privacy concern. Keep it short and skippable-but-nudged.

**Magic moment:** Student walks in, taps their seat, confirms the four people around them — meeting someone — and plays a 30-second name game while the room fills. Emotion: a small, genuine "huh, that was kind of nice." This is the hook.

**Habit formation:** By week three, check-in is automatic and the room is no longer strangers. The professor knows names; students recognize each other. Emotion (faculty): quiet satisfaction and command of the room. Emotion (student): less anonymous, mild curiosity about the jobs promise.

**Advocacy:** The professor mentions it to a colleague; a student mentions the (coming) jobs angle to a friend. Emotion: ownership. This is where the Spring 2027 pilots come from.

## 3. Product Strategy

### Product Principles

- **Zero-work faculty onboarding.** If a professor can't be up and running in under five minutes with no training, we've failed. Every setup step is a candidate for deletion or AI automation.
- **The mechanic must double as the meaning.** Check-in isn't just attendance — it forces an introduction. Waiting for class isn't dead time — it's a name game. Every utility feature also builds community; that fusion is the product.
- **Verification over trust.** Anywhere a student could game the system (attendance, presence, engagement), design assumes they will and builds in a peer- or system-check. This is what separates ClassAct from clickers.
- **Consent-gated data, visibly.** Students can see and control what's collected and what leaves the room. Make the privacy posture obvious in the UI, not buried in a policy.
- **Mobile for the moment, laptop for the work.** Check-in happens on a phone in a crowded room; profiles, games, and dashboards are comfortable on a laptop. One responsive app, but designed for both contexts deliberately.
- **Build the foundation, ship the feature.** Data models and architecture anticipate the full platform (metrics, jobs, engagement), but we only ship the community MVP. Foundation-thinking, feature-discipline.

### Market Differentiation

Every existing tool treats the classroom as either an administrative record (Canvas/Blackboard), a remote polling device (Top Hat/clickers), or an online forum (Piazza). None of them care where a student is physically sitting or whether they know the person next to them. ClassAct's entire premise is the physical room — and that's defensible for two reasons. First, the seat-map + peer-verification mechanic solves the attendance-fraud problem that clickers structurally cannot, because it makes other students the verifiers rather than a gameable device. Second, ClassAct aligns incentives no competitor does: it's the only tool that gives faculty pain relief *and* gives students a self-interested reason (jobs) to engage. Competitors sell professors on engagement (which they don't value) or sell students on convenience (which doesn't move them). ClassAct sells each side the only thing it actually wants. The long-term moat is the data exhaust — a consented, behavior-based signal of which students are genuinely great collaborators — which is far richer than GPA and, handled correctly, becomes a placement engine no LMS can replicate.

### Magic Moment Design

The magic moment is: *a student walks into a hall of strangers, taps their seat, confirms the four people around them, plays a 30-second name game, and by week three the room isn't anonymous anymore.* For this to happen reliably, several things must be true in the MVP: (1) the student is already onboarded with a profile and photos *before* they walk in — so onboarding must happen at join time, not at the door; (2) the seat map is set up and the check-in is instantaneous even under concurrent load; (3) peer verification is frictionless — a student taps to confirm the names shown for the seats around them, and those names/faces come from completed profiles; (4) the name game is genuinely quick and fun enough to beat the reflex to open Instagram. The shortest path from sign-up to magic moment is: join code → magic-link activation → profile + photos → (next class) → seat tap → verify neighbors → name game. Everything in the MVP exists to make that single chain work. Nothing that doesn't serve this chain belongs in v1. The magic moment is fully achievable in the MVP as scoped — good; that's the test that the scope is right.

### MVP Definition

The MVP is the **classroom-community core**, buildable in roughly 4–8 weeks by a solo founder with AI, and — critically — carve-out-able into a standalone "verified attendance + networking" app if scope runs long.

**In scope:**

- **Faculty course setup + seat map.** Create a course, generate a join code, define the room layout (rows/seats via a simple builder or photo/description). Done = a professor can stand up a course and room in under five minutes.
- **Student onboarding.** Join via code, activate via magic link, build a profile: three photos (candid selfie, professional headshot, adventure shot) + a few professor-selected icebreaker fields (two truths and a lie, first job, Spotify playlist URL). Done = a student can complete a usable profile on a phone in a couple of minutes.
- **Roster import (CSV).** Faculty upload a class roster (the pragmatic stand-in for "Canvas integration"). Done = students can be matched to a pre-loaded roster; a professor can see who has and hasn't activated.
- **Live seat-map check-in with peer verification.** Student selects their seat on a live map; confirms the identities of neighbors (front/back/left/right); earns a networking point for a new seat. Done = attendance is recorded, verified by peers, and can't be completed remotely.
- **Name games.** Memory-tiles and flash-card games built from classmates' profile photos, offered while waiting for class. Done = a student can play a round and their score is recorded.
- **Networking score + basic ClassAct Metrics.** A simple dashboard: seats visited, people met, name-game scores. Done = a student sees their standing; a professor sees participation at a glance.

**"Magic moment achievable in MVP?"** Yes — the in-scope list is exactly the chain the magic moment requires. Scope is correct.

### Explicitly Out of Scope

- **Lecture dashboard + attention tracking.** Tempting because it's the daily-engagement play. Deferred: it's a large build and raises the surveillance concern most; add after community is proven (revisit Phase 2, Spring 2027).
- **AI think-pair-share / one-minute papers.** The crown jewel of the faculty-labor story. Deferred because it depends on ingesting lecture materials and generating quality questions — a meaty AI build that shouldn't gate the community MVP. Revisit immediately after the MVP.
- **Peer grading, shout-outs, group-project feedback, faculty feedback.** All valuable, all social-feature builds that assume an active, trusting user base ClassAct won't have on day one. Revisit post-MVP once the room is engaged.
- **Jobs marketplace + employer interface.** The revenue engine and the student carrot — but a two-sided marketplace is a company unto itself and requires employer supply we can't generate during a single-class pilot. Deferred to a much later phase; the *promise* can be messaged earlier.
- **Deep Canvas/Blackboard API integration + grade push-back.** Claimed via CSV roster import in the MVP; real API integration deferred until multiple institutions justify it.
- **Payments / placement fees.** No monetization in the MVP; the app is free during the pilot years.

### Feature Priority (MoSCoW)

- **Must Have:** Faculty course + seat-map setup; student join + magic-link onboarding; profiles with 3 photos + icebreakers; CSV roster import; live seat-map check-in with peer verification; networking score.
- **Should Have:** Name games (memory tiles + flash cards); basic ClassAct Metrics dashboard; professor activation/participation overview.
- **Could Have:** "Unique fact" memory-game variant; seat-change nudges; profile prompt variety; simple export of attendance.
- **Won't Have (this time):** Lecture dashboard, attention tracking, AI think-pair-share, peer grading, shout-outs, group feedback, faculty feedback, jobs marketplace, employer portal, Canvas API + grade push-back, payments.

### Core User Flows

**Flow 1 — Faculty sets up a class (trigger: professor decides to try it).** Sign in → create course → upload roster CSV → build/describe seat map → get join code and activation email copy → done. Success: course exists, room mapped, join code ready, in under five minutes.

**Flow 2 — Student onboards (trigger: receives join code).** Open link → magic-link auth → enter join code → match to roster → upload 3 photos → answer icebreaker fields → land on class home. Success: complete profile before first class, in a couple of minutes on a phone.

**Flow 3 — In-class check-in + magic moment (trigger: student walks into class).** Open app → live seat map → tap seat → confirm neighbors' identities → earn networking point for new seat → prompted into a name game while waiting. Success: verified attendance recorded, a real introduction made, a name-game round played — all in under a minute of active effort.

### Success Metrics

- **Primary metric:** Weekly verified check-in rate in Mike's pilot class (verified attendances ÷ enrolled-and-present). Good = 70%+ of present students check in and get verified; Great = 90%+, with negligible detectable fraud.
- **Secondary metrics:** Profile completion rate (Good 60% / Great 85%); name-game participation among waiting students (Good 30% / Great 60%); unique seats/people met per student over the semester (evidence the networking mechanic works); professor time spent on attendance (target: ~0 minutes of class time).
- **Leading indicators:** Activation rate from join code (Good 70% / Great 90%); time-to-complete first check-in (target <60s); concurrent check-in success without errors at full-room load; number of colleagues who ask to pilot in Spring after seeing it (Great = 2+).

### Risks

- **Student refusal / backlash (high likelihood, high impact).** Students may reject it as surveillance, especially before the jobs payoff exists. Mitigation: lead with the community/name benefit, make data control visible, keep effort trivial, and be honest that the jobs engine is coming.
- **Concurrent-load failure at check-in (medium likelihood, high impact).** If the seat map jams when a full room checks in at once, the core moment breaks publicly in front of a class. Mitigation: build realtime on Supabase's proven primitives, load-test before going live, design a graceful degraded path (e.g., queued check-in).
- **Faculty onboarding friction (medium likelihood, high impact).** If setup feels like work, professors won't adopt — the whole thesis. Mitigation: obsess over the five-minute setup; automate the seat map with AI; pre-seed accounts in later phases.
- **FERPA / data-privacy escalation (medium likelihood, high impact).** Student data + eventual jobs use is exactly where universities get nervous. Mitigation: student-owned-data as a hard value, consent gates, confirm single-class pilot permissibility with Clemson before broad push.
- **Peer-verification collusion (medium likelihood, medium impact).** Rows could cover for absent friends. Mitigation: monitor verification patterns, randomize/expand who verifies whom, treat as a data-integrity problem to iterate on.
- **Single-classroom validity (medium likelihood, medium impact).** What works in Mike's marketing class may not generalize. Mitigation: treat Spring invited-colleague pilots as the real generalization test; don't over-fit the product to one room.
- **Two-sided marketplace never materializes (lower near-term likelihood, high long-term impact).** The revenue model needs employer demand that's hard to bootstrap. Mitigation: it's deliberately out of the MVP; validate student/faculty value first and revisit monetization once there's a network.
- **Founder time (high likelihood, medium impact).** A full-time professor building solo. Mitigation: ruthless scope, AI-assisted build, the carve-out-to-attendance-app escape hatch if bandwidth runs short.

## 4. Brand Strategy

### Positioning Statement

For **face-to-face college professors** who **are tired of faked attendance and a room full of disengaged strangers**, **ClassAct** is the **in-person classroom app** that **verifies attendance in zero class time and gets students to actually know each other — while the AI handles the work you'd never do yourself**. Unlike **clickers, Top Hat, or Piazza**, ClassAct **is built around the physical room and can't be gamed, and it gives students their own reason to care: the path to a job.**

### Brand Personality

ClassAct is the sharp, unflappable colleague down the hall who has taught for years and has zero patience for ed-tech nonsense. In conversation they're dry, concrete, and a little funny — they tell you exactly what's broken and exactly how this fixes it, then stop talking. They'd wear a good blazer, not a startup hoodie. They never oversell, never say "revolutionary," never gush about "the future of learning." They respect that you're busy and smart, so they don't waste your time or explain things you already know. Around students they drop the professor register entirely — plain, direct, a bit wry, never preachy, and conspicuously not trying to sound cool or lean on "AI." They'd rather under-promise and let the thing work than hype it and disappoint.

### Voice & Tone Guide

**Voice (constant):** Plain-spoken, concrete, dry, confident, anti-hype. Short sentences. Real nouns. No buzzwords.

| Context | DO | DON'T |
|---|---|---|
| Onboarding (faculty) | "Set up your room once. Attendance runs itself after that." | "Welcome to the future of classroom engagement! 🚀" |
| Onboarding (student) | "Add a few photos so people can put a name to your face. Takes two minutes." | "Build your personal brand and unlock your learning journey!" |
| Empty state | "No one's checked in yet. Your seat map lights up as students arrive." | "Nothing to see here... for now!" |
| Loading | "Loading your class…" | "Hang tight while we work our magic ✨" |
| Success (check-in) | "You're checked in, seat 4C. You've now met 3 new people this semester." | "Woohoo! You crushed check-in! 🎉" |
| Error (check-in) | "Couldn't confirm your seat — try again, or pick a different seat." | "Oops! Something went wrong 😅" |
| Marketing (faculty) | "Students can't fake attendance. It takes zero minutes of class. That's the pitch." | "Transform engagement and supercharge outcomes with AI-powered learning." |
| Privacy note | "You own your data. Nothing leaves this class unless you say so." | "We value your privacy." (vague, unearned) |

### Messaging Framework

- **Tagline:** *Attendance that can't be faked. A class that's not full of strangers.*
- **Homepage headline (faculty-facing):** *Take attendance in zero class time — and no, they can't cheat it.*
- **Value propositions:**
  1. *Fraud-proof attendance.* Students verify each other in the room. No clickers to hand off, no logging in from bed.
  2. *A room that actually knows itself.* Seat check-in makes students meet their neighbors; name games mean everyone learns names by week three.
  3. *You do nothing new.* Set up your room once. The app — and the AI behind it — handles the rest.
- **Feature descriptions (plain):** "Seat-map check-in: students tap their seat and confirm the people around them." "Name games: quick photo-matching games students play while class fills up." "ClassAct Metrics: a simple read on who's showing up and taking part."
- **Objection handlers:** *"Does it work with Canvas/Blackboard?"* → "Yes — import your roster and you're set." *"Will my students hate it?"* → "They won't love the attendance part. They will care that it eventually connects them to jobs — and in the meantime, they'll actually meet people." *"Is this a lot of setup?"* → "One room setup, about five minutes. After that it runs itself." *"Is this an AI surveillance thing?"* → "Students own their data and control what's shared. The AI stays quietly in the background."

### Elevator Pitches

- **5-second:** "It's fraud-proof attendance that also gets your students to actually know each other."
- **30-second:** "ClassAct is an app for in-person college classes. Students check in by tapping their seat and confirming the people around them — so attendance can't be faked and, as a side effect, they meet their neighbors. Name games teach everyone's names in the first few weeks. Professors do almost nothing; the AI handles the work. Later, engaged students get connected to jobs, which is the thing that actually motivates them."
- **2-minute:** "Here's the problem. In a big college lecture, attendance is a joke — students click in from bed or hand a friend their clicker — and the room is a hundred strangers half of them shopping online. Professors hate all of it, but they won't adopt anything that adds work, and they don't care about 'engagement' as a pitch. Students care even less — the only thing that moves them is a job. So most classrooms just stay broken. ClassAct fixes it by making the mechanic do double duty: students check in by tapping their actual seat and confirming the four people around them. That kills attendance fraud — you can't verify a ghost — and it forces a real introduction. While the room fills, they play a quick name game built from classmates' photos, so by week three nobody's anonymous. The professor sets up their room once, in about five minutes, and after that the AI runs everything. Why now: this failed before because it needed faculty labor no one would give — AI finally removes that constraint. Why us: I'm a professor living this problem every week, I've built this category before and learned exactly why it failed, and I've got a classroom to prove it in this fall. The long game is that engagement generates a consented signal of which students are genuinely great to work with — better than GPA — and we become the bridge to employers. The ask: I'm piloting in my own class this fall and I'm looking for a handful of colleagues to run it in the spring."

### Competitive Differentiation Narrative

Top Hat and clickers pretend to solve attendance but any student can defeat them in five seconds — click in from home, carry a friend's device. Piazza moved discussion online and then torched its trust selling student data. Canvas and Blackboard are filing cabinets professors barely open. Every one of them ignores the physical room — where the student actually is, who they're sitting next to, whether they know a single name. ClassAct is built entirely around that room. Because students verify each other, attendance can't be faked the way a device can. Because checking in means meeting your neighbors, the anti-fraud mechanic is also the community mechanic. And because we align incentives no one else does — real pain relief for faculty, a real path to jobs for students — both sides have a reason to actually use it. The endgame is a consented, behavior-based read on who's genuinely a great collaborator, which is a far better hiring signal than a GPA, and something no LMS is positioned to build.

## 5. Visual Design

Visual design tokens (colors, typography, spacing, components, motion) live in `docs/design.md`. If that file does not yet exist, run the Design System skill with image references to generate it before building.
