import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
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

  // Onboarding gate: students finish onboarding before using the app.
  // /onboarding lives outside this layout group, so no redirect loop.
  if (profile.role === "student" && !profile.onboarding_complete) {
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
