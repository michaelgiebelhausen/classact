import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, getMembership } from "@/lib/auth";
import { needsOnboarding } from "@/lib/membership";
import { Sidebar } from "@/components/features/Sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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
  if (membership && needsOnboarding(membership, profile.onboarding_complete)) {
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border/60 bg-background/80 px-6 backdrop-blur-md">
          <span className="font-[family-name:var(--font-heading)] text-lg font-medium tracking-tight">
            ClassAct
          </span>
          <div className="ml-auto flex items-center gap-3">
            <form action="/auth/signout" method="post">
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
            {/* The obvious place people click for their own account. */}
            <Link
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
        <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
