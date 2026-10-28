import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, getMembership } from "@/lib/auth";
import { needsOnboarding } from "@/lib/membership";
import { Sidebar } from "@/components/features/Sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/server";
import { StudentViewControls } from "@/components/features/StudentViewControls";

function initials(name: string | null): string {
  if (!name) return "ME";
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  // Onboarding gate: you finish onboarding once you're actually in someone's
  // class. /onboarding lives outside this layout group, so no redirect loop.
  //
  // Keyed on holding an enrollment, not on `role === "student"`. The old form
  // meant "isn't flagged a professor", which held a brand-new account with no
  // classes at a gate it had nothing to satisfy, and let a professor sitting
  // in a colleague's class skip the onboarding that class is owed. A failed
  // count returns null and we let them through rather than trapping someone
  // behind a hiccup.
  const membership = await getMembership(profile.id);
  const client = await createClient();
  const [{ data: taught }, { data: practices }] = await Promise.all([
    client.from("courses").select("id").eq("professor_id", profile.id),
    client.from("courses").select("id, practice_source_id, practice_routes").eq("practice_instructor_id", profile.id),
  ]);
  if (membership && needsOnboarding(membership, profile.onboarding_complete)) {
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar practiceIds={(practices ?? []).map(p => p.id)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-3 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur-md sm:px-6 has-[[data-practice]]:[&_[data-account-link]]:hidden">
          <span className="font-[family-name:var(--font-heading)] text-lg font-medium tracking-tight">
            ClassAct
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <StudentViewControls taught={(taught ?? []).map(c => c.id)} practices={(practices ?? []).filter(p => p.practice_source_id !== null).map(p => ({ ...p, practice_source_id: p.practice_source_id! }))} />
            <form action="/auth/signout" method="post">
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
            {/* The obvious place people click for their own account. */}
            <Link
              data-account-link
              href="/profile"
              prefetch={false}
              className="flex items-center gap-3 rounded-full pl-2 transition-opacity hover:opacity-80"
              aria-label="My profile"
            >
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {profile.full_name ?? "My profile"}
              </span>
              <Avatar className="size-9">
                <AvatarFallback className="bg-gradient-to-br from-[var(--gold)] to-[#c9822a] text-sm font-bold text-white">
                  {initials(profile.full_name)}
                </AvatarFallback>
              </Avatar>
            </Link>
          </div>
        </header>
        {/* A page opts into a big monitor's full width with data-wide (the
            grading cockpit does); everything else keeps a readable measure. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-8 has-[[data-wide]]:max-w-[120rem]">
          {children}
        </main>
      </div>
    </div>
  );
}
