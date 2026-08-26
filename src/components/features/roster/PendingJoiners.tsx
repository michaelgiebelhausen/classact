"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approveJoiners } from "@/server/actions/activation";
import type { StagedPerson } from "@/components/features/roster/StagedRoster";

/**
 * Students who joined with the course code and are waiting to be let in.
 *
 * Called out above the rest of the section because they are the group most
 * likely to cause a scene: they signed up, they joined, they believe they are
 * fine — and `checkIn` requires `status = 'active'`, so they tap a seat and are
 * told they aren't on the roster. Nothing anywhere told them, or the
 * professor, that an approval was pending.
 *
 * Approving is not destructive and not final: it sets a status, and the
 * student can be dropped later like anyone else.
 */
export function PendingJoiners({
  courseId,
  people,
}: {
  courseId: string;
  people: StagedPerson[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (people.length === 0) return null;

  async function approve(ids: string[], key: string) {
    setBusy(key);
    const result = await approveJoiners({ courseId, enrollmentIds: ids });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    const n = result.data?.approved ?? ids.length;
    toast.success(
      `Approved ${n}. They can check in now.`,
      { duration: 8000 }
    );
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm font-medium">
        {people.length} {people.length === 1 ? "person" : "people"} joined with
        the course code and {people.length === 1 ? "is" : "are"} waiting on you.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        They have working accounts and think they&apos;re set — but check-in
        turns them away until they&apos;re approved. Worth clearing before
        class.
      </p>

      <div className="mt-3 grid gap-1.5">
        {people.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-muted-foreground">{p.email}</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy !== null}
              onClick={() => approve([p.id], p.id)}
            >
              {busy === p.id ? "Approving…" : "Approve"}
            </Button>
          </div>
        ))}
      </div>

      {people.length > 1 && (
        <Button
          size="sm"
          className="mt-3"
          disabled={busy !== null}
          onClick={() => approve(people.map((p) => p.id), "all")}
        >
          {busy === "all" ? "Approving…" : `Approve all ${people.length}`}
        </Button>
      )}
    </div>
  );
}
