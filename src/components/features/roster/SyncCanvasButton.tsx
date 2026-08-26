"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncCanvasRoster } from "@/server/actions/canvas";

/**
 * "Sync with Canvas", on the class roster itself.
 *
 * Adds and confirmations apply immediately — they can only ever move a student
 * closer to being in the class. Departures do not: the sync records who Canvas
 * stopped listing, and they appear in the "No longer on Canvas" section below
 * for the professor to confirm.
 *
 * That asymmetry is deliberate. Canvas going quiet about a student is not
 * proof they left: an expired token, a section change, or a cross-listed shell
 * all produce the same silence, and students added by CSV are never in Canvas
 * to begin with. Dropping on that evidence benches real students mid-semester.
 *
 * No drop UI here on purpose — the section below owns that, so there is only
 * ever one place to do it.
 */
export function SyncCanvasButton({
  courseId,
  canvasCourseId,
  sectionIds,
  syncedAt,
}: {
  courseId: string;
  canvasCourseId: string | null;
  sectionIds: string[] | null;
  syncedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!canvasCourseId) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/course/${courseId}/setup`}>Connect Canvas</Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          This class isn&apos;t linked to a Canvas course yet.
        </span>
      </div>
    );
  }

  async function runSync() {
    setBusy(true);
    const result = await syncCanvasRoster({
      courseId,
      canvasCourseId: canvasCourseId!,
      sectionIds: sectionIds ?? undefined,
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 10_000 });
      return;
    }

    const d = result.data!;
    const parts = [
      d.imported > 0 && `${d.imported} added`,
      d.confirmed > 0 && `${d.confirmed} confirmed from Canvas`,
      d.reactivated > 0 && `${d.reactivated} back from dropped`,
      d.merged > 0 && `${d.merged} duplicate${d.merged === 1 ? "" : "s"} merged`,
      d.photosStored > 0 && `${d.photosStored} photos`,
    ].filter(Boolean) as string[];

    toast.success(
      parts.length > 0
        ? `Synced — ${parts.join(", ")}.`
        : "Synced — the roster already matched Canvas."
    );

    if (d.dropCandidates.length > 0) {
      toast.info(
        `${d.dropCandidates.length} no longer in Canvas — review them in "No longer on Canvas" below.`,
        { duration: 10_000 }
      );
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={runSync} disabled={busy} variant="outline" size="sm">
        {busy ? "Syncing…" : "Sync with Canvas"}
      </Button>
      <span className="text-xs text-muted-foreground">
        Adds new students, confirms anyone who joined on their own, and flags
        who Canvas no longer lists.
        {syncedAt && ` Last synced ${new Date(syncedAt).toLocaleDateString()}.`}
      </span>
    </div>
  );
}
