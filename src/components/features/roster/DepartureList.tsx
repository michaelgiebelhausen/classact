"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markDropped } from "@/server/actions/canvas";
import type { StagedPerson } from "@/components/features/roster/StagedRoster";

/**
 * The "no longer on Canvas" section: a worklist, not a gallery.
 *
 * Rendered as a checkable list rather than the face grid the other sections
 * use, because this is the one section that asks the professor to decide
 * something. Students are imported in the summer and drop through the first
 * weeks, so this is an ordinary recurring chore, not an edge case.
 *
 * Nothing is pre-ticked. Canvas going quiet about someone is not proof they
 * left — an expired token, an unsynced section, or a CSV-added student all
 * look identical from here — so the professor ticks who really went. Dropping
 * sets a status and keeps their history; it does not delete anyone.
 */
export function DepartureList({
  courseId,
  people,
}: {
  courseId: string;
  people: StagedPerson[];
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allChecked = checked.size === people.length && people.length > 0;

  async function drop() {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    const result = await markDropped({ courseId, enrollmentIds: ids });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const n = result.data?.dropped ?? ids.length;
    toast.success(
      `Dropped ${n} student${n === 1 ? "" : "s"}. Their attendance history is kept.`
    );
    setChecked(new Set());
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        {people.map((p) => (
          <label
            key={p.id}
            className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <input
                  type="checkbox"
                  checked={checked.has(p.id)}
                  onChange={(e) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-muted-foreground">{p.email}</span>
            {p.note && (
              <span className="text-xs text-muted-foreground">· {p.note}</span>
            )}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || checked.size === 0}
          onClick={drop}
        >
          {busy
            ? "Dropping…"
            : `Drop ${checked.size > 0 ? checked.size : "selected"}`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            setChecked(
              allChecked ? new Set() : new Set(people.map((p) => p.id))
            )
          }
        >
          {allChecked ? "Clear all" : "Select all"}
        </Button>
      </div>
    </div>
  );
}
