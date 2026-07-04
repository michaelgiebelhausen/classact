import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Role } from "@/types/db";

export function AppNav({ role, name }: { role: Role; name: string | null }) {
  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
          ClassAct
        </Link>
        <nav className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">
              {role === "professor" ? "My courses" : "My classes"}
            </Link>
          </Button>
          {role === "student" && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/profile">My profile</Link>
            </Button>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {name ?? ""}
        </span>
        <form action="/auth/signout" method="post">
          <Button variant="outline" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
