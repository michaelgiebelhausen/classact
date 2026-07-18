import Link from "next/link";
import {
  Armchair,
  ArrowRight,
  BarChart3,
  FileUp,
  FolderKanban,
  ImageIcon,
  MonitorPlay,
  Sparkles,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/** One walkthrough section per tool, each with its own accent from the palette. */
interface Feature {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  Icon: LucideIcon;
  soft: string;
  solid: string;
  /** What the professor can fill this placeholder with later. */
  image: string;
}

const FEATURES: Feature[] = [
  {
    id: "check-in",
    eyebrow: "Attendance",
    title: "Check-In",
    body: "Taking attendance is a hassle — and, increasingly, a mandate. ClassAct turns it into a two-second tap: students check into a seat on a live map of your room and confirm the classmates on either side of them. Attendance is verified, roll-call fraud is impossible, and — the part students actually care about — they meet the people they've been sitting next to all semester.",
    Icon: Armchair,
    soft: "var(--flame-soft)",
    solid: "var(--flame)",
    image:
      "A phone showing the live seat-map grid — one seat lighting up as a student taps to check in, a couple of neighboring seats marked “verified.”",
  },
  {
    id: "name-games",
    eyebrow: "Names",
    title: "Networking",
    body: "Learning forty names isn't quite a pain, but it's a real challenge — for the professor and every student in the room. ClassAct makes a game of it, rewarding students for learning each other's faces and names, and helping you do the same. By week three, nobody's a stranger — and a class that knows its own names simply works better.",
    Icon: Sparkles,
    soft: "var(--gold-soft)",
    solid: "var(--gold)",
    image:
      "The flash-card name game mid-play — a classmate's photo with the name just revealed and a streak counter climbing.",
  },
  {
    id: "lockdown-lectures",
    eyebrow: "Focus",
    title: "Lockdown Laptops",
    body: "Dopamine is a formidable opponent, and enforcing a no-laptop policy is a losing battle. So instead of banning the screen, ClassAct puts something worth watching on it: your slides, synced to wherever you are, with a private space to take notes. When a student drifts off toward the cat videos, a gentle nudge brings them back to class.",
    Icon: MonitorPlay,
    soft: "var(--sky-soft)",
    solid: "var(--sky)",
    image:
      "A laptop showing the synced current slide with a notes panel beside it, and a small “come back to class” nudge in the corner.",
  },
  {
    id: "active-learning",
    eyebrow: "Discussion",
    title: "Automated Active Learning",
    body: "Peer instruction works — when it's run well, which takes prep most weeks don't allow. ClassAct reads your slides and drafts research-backed think-pair-share questions, then runs the whole choreography for you: pose the question, poll the room, pair up students who disagree, and re-vote once they've argued it out. You get the rich discussion; ClassAct handles the logistics.",
    Icon: Vote,
    soft: "var(--sage-soft)",
    solid: "var(--sage)",
    image:
      "The think-pair-share result — a before/after vote bar chart — with two students at a desk comparing answers.",
  },
  {
    id: "group-projects",
    eyebrow: "Teamwork",
    title: "Group Project Monitoring",
    body: "Upload the assignment and ClassAct breaks it into manageable tasks, then hands each student team a simple Kanban board to divide and track the work. Built-in accountability — time estimates, contribution shares, and a way to flag work that didn't really get done — keeps the load fair and heads off the group-project disputes that usually land on your desk.",
    Icon: FolderKanban,
    soft: "var(--plum-soft)",
    solid: "var(--plum)",
    image:
      "The team task board: Unassigned → a column per student → Done, each card showing a time estimate, with one card flagged.",
  },
  {
    id: "participation-stats",
    eyebrow: "Feedback",
    title: "Participation Statistics",
    body: "ClassAct quietly tracks the signals that matter — engagement, initiative, leadership, dependability — and turns them into clear statistics. Students see their own numbers as honest feedback on how they're growing, and on what a future employer would notice. You get an objective basis for grading participation, instead of a fuzzy end-of-semester guess.",
    Icon: BarChart3,
    soft: "var(--rose-soft)",
    solid: "var(--rose)",
    image:
      "The Work Readiness panel — competency cards like Dependability and Leadership carrying “Strong” and “Standout” badges.",
  },
];

/** Pain-relief → student-payoff pairs — the thesis, made concrete. */
const DUAL_BENEFIT: { pain: string; payoff: string }[] = [
  {
    pain: "Taking attendance",
    payoff: "Students meet the people around them",
  },
  {
    pain: "Learning a sea of names",
    payoff: "The whole room learns each other's names",
  },
  {
    pain: "Policing laptops",
    payoff: "Students stay focused and take better notes",
  },
  {
    pain: "Orchestrating peer instruction",
    payoff: "Students argue ideas and learn actively",
  },
  {
    pain: "Refereeing group projects",
    payoff: "Teams share the load fairly and build skills",
  },
  {
    pain: "Guessing at participation grades",
    payoff: "Students get real feedback on their growth",
  },
];

function BrandMark() {
  return (
    <span
      className="grid size-9 place-items-center rounded-[11px] font-[family-name:var(--font-heading)] text-lg font-semibold text-white shadow-[0_6px_16px_-4px_rgba(224,85,47,0.6)]"
      style={{
        backgroundImage: "linear-gradient(to bottom right, var(--flame), #c33d1c)",
      }}
      aria-hidden
    >
      C
    </span>
  );
}

/** Dashed, accent-tinted stand-in for imagery the professor adds later. */
function ImagePlaceholder({
  soft,
  solid,
  description,
}: {
  soft: string;
  solid: string;
  description: string;
}) {
  return (
    <div
      className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center"
      style={{ borderColor: solid, background: soft }}
    >
      <ImageIcon className="size-8" style={{ color: solid }} aria-hidden />
      <p className="max-w-xs text-xs leading-relaxed" style={{ color: solid }}>
        <span className="font-semibold uppercase tracking-wide">
          Image to add
        </span>
        <br />
        {description}
      </p>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-lg font-semibold tracking-tight">
              ClassAct
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link href="/join">I have a join code</Link>
            </Button>
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {/* ---------- Hero ---------- */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 pb-16 pt-16 md:grid-cols-2 md:gap-12 md:pt-24">
          <div className="flex flex-col items-start gap-6">
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
              style={{ background: "var(--flame-soft)", color: "var(--flame)" }}
            >
              For the in-person classroom
            </span>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Eliminate professor pain.
              <br />
              <span style={{ color: "var(--flame)" }}>
                Create student opportunity.
              </span>
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              ClassAct turns the classroom chores everyone dreads — attendance,
              laptops, participation, group projects — into a single process
              that leaves students more connected, more engaged, and more
              employable.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/login">
                  Set up your class <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/join">Join with a code</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Works with your Canvas or Blackboard roster. Students own their
              data — nothing leaves the class unless they say so.
            </p>
          </div>
          <ImagePlaceholder
            soft="var(--flame-soft)"
            solid="var(--flame)"
            description="A warm, wide shot of a full lecture hall from the front — students at desks with ClassAct open on their laptops and a professor mid-gesture, natural light, collegiate feel."
          />
        </section>

        {/* ---------- Thesis band (dark) ---------- */}
        <section
          className="w-full"
          style={{ background: "var(--sidebar)", color: "#eef0f5" }}
        >
          <div className="mx-auto w-full max-w-4xl px-6 py-16 text-center md:py-20">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Not a pile of apps. A process.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[#c7cbd6]">
              Most classroom software hands you a drawer full of disconnected
              tools. ClassAct is one deliberate process instead — designed to
              lift the work faculty dread off your plate in a way that, at every
              step, makes students better. Take attendance, keep laptops honest,
              run peer instruction, score participation, keep the peace on group
              projects: each chore becomes an opportunity for students to
              network, engage, and learn.
            </p>
            <p className="mx-auto mt-6 flex max-w-2xl items-center justify-center gap-2 text-lg font-medium text-white">
              <FileUp className="size-5" style={{ color: "var(--flame)" }} />
              All you upload is your syllabus and your slides. ClassAct does the
              rest.
            </p>
          </div>
        </section>

        {/* ---------- Feature walkthrough ---------- */}
        <div className="mx-auto w-full max-w-6xl px-6">
          {FEATURES.map((f, i) => (
            <section
              key={f.id}
              id={f.id}
              className="grid items-center gap-8 border-b border-border/60 py-16 md:grid-cols-2 md:gap-14"
            >
              <div className={i % 2 === 1 ? "md:order-2 md:pl-4" : "md:pr-4"}>
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-11 place-items-center rounded-xl"
                    style={{ background: f.soft, color: f.solid }}
                  >
                    <f.Icon className="size-6" strokeWidth={1.75} />
                  </span>
                  <span
                    className="text-xs font-semibold uppercase tracking-[0.14em]"
                    style={{ color: f.solid }}
                  >
                    {f.eyebrow}
                  </span>
                </div>
                <h3 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {f.title}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </div>
              <div className={i % 2 === 1 ? "md:order-1" : ""}>
                <ImagePlaceholder
                  soft={f.soft}
                  solid={f.solid}
                  description={f.image}
                />
              </div>
            </section>
          ))}
        </div>

        {/* ---------- Dual-benefit recap ---------- */}
        <section className="mx-auto w-full max-w-5xl px-6 py-16 md:py-20">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Every chore, turned into an opportunity
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              The same feature that takes work off your plate is the one that
              moves a student forward.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 border-b bg-secondary/60 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:gap-x-8 sm:px-8">
              <span>What ClassAct takes off your plate</span>
              <span aria-hidden />
              <span>What it gives your students</span>
            </div>
            {DUAL_BENEFIT.map((row) => (
              <div
                key={row.pain}
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 border-b px-5 py-4 last:border-b-0 sm:gap-x-8 sm:px-8"
              >
                <span className="text-sm text-muted-foreground line-through decoration-[var(--flame)]/50">
                  {row.pain}
                </span>
                <ArrowRight
                  className="size-4 shrink-0"
                  style={{ color: "var(--flame)" }}
                  aria-hidden
                />
                <span className="text-sm font-medium">{row.payoff}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Final CTA ---------- */}
        <section className="mx-auto w-full max-w-3xl px-6 pb-24 text-center">
          <div
            className="rounded-3xl border px-8 py-14"
            style={{ background: "var(--card)" }}
          >
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Your next class, minus the busywork
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Set up your room once — about five minutes — then upload your
              syllabus and slides. ClassAct runs the rest, class after class.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/login">
                  Set up your class <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/join">Join with a code</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t px-6 py-6 text-center text-xs text-muted-foreground">
        ClassAct · classact.college — eliminating professor pain, creating
        student opportunity.
      </footer>
    </div>
  );
}
