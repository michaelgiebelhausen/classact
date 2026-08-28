import Link from "next/link";
import { env } from "@/lib/env";
import { GraduationCap, Presentation } from "lucide-react";

/**
 * The only place ClassAct asks whether you're teaching or attending — shown to
 * an account that belongs to nothing yet, and shown once, because the next
 * thing you do makes it true.
 *
 * The answer is NOT stored. Tapping "I am a professor" doesn't make you one;
 * creating a course does, and creating a course goes through checkout, which
 * is a wall no student wanders into by accident. Tapping the wrong one costs
 * a Back button, not a semester.
 *
 * Two assumptions shape the layout. First, some students click whatever is in
 * front of them, so both doors are the same size and neither is pre-selected
 * — there is no default to fall through. Second, "Create a course" reads to a
 * student as "join a course": the words that carry the meaning are "I am a
 * professor" and "I am a student", so those are the headings, and what
 * happens next is spelled out underneath (including the price, before the
 * click, not after it).
 */
export function WhichAreYou() {
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to ClassAct
        </h1>
        <p className="text-sm text-muted-foreground">
          Which one brings you here? You can do both later — nothing here is
          locked in.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Door
          href="/join"
          icon={<GraduationCap className="size-7" strokeWidth={1.75} />}
          heading="I am a student."
          action="I would like to join an existing course."
          detail="You'll need the join code your professor gave you. Free."
        />
        <Door
          href="/course/new"
          icon={<Presentation className="size-7" strokeWidth={1.75} />}
          heading="I am a professor."
          action="I would like to create a new course."
          detail={
            // Don't quote a price that isn't being charged. Billing is the
            // wall that stops a mis-tap here from mattering, and while
            // BILLING_ENABLED is off there isn't one — so say what actually
            // happens instead. Either way a wrong tap is now cheap: the
            // dashboard shows courses and classes together, so nobody ends up
            // on the wrong side of the app with no way back.
            env.billingEnabled
              ? "Sets up a room and a join code to hand your class. $4.99/month."
              : "Sets up a room and a join code to hand your class. If you're here to attend one, go left."
          }
        />
      </div>
    </div>
  );
}

/**
 * Students first, on purpose. There are forty of them per professor, and the
 * one on the left is the one a hurried thumb finds.
 */
function Door({
  href,
  icon,
  heading,
  action,
  detail,
}: {
  href: string;
  icon: React.ReactNode;
  heading: string;
  action: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="group grid content-start gap-2 rounded-xl border border-border bg-card p-6 text-left transition-colors hover:border-[var(--flame)] hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--flame)]"
    >
      <span className="text-muted-foreground transition-colors group-hover:text-[var(--flame)]">
        {icon}
      </span>
      <span className="text-lg font-semibold tracking-tight">{heading}</span>
      <span className="text-sm text-foreground/80">{action}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </Link>
  );
}
