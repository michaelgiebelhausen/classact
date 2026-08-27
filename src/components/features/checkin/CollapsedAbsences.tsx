"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Requested absences, closed by default.
 *
 * This list is one student's private business — why they missed a class,
 * sometimes medically — on a page a professor projects to the whole room. It
 * used to render open, and the only defence was zooming the browser until it
 * scrolled off the projector, live, in front of the class.
 *
 * Closed by default and placed under the last class's seat map, so it is both
 * shut and below the fold. Two accidents have to happen before anything
 * private is on screen, and neither is a mis-scroll.
 */
export function CollapsedAbsences({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"} scheduled absences
          {count > 0 ? ` (${count})` : ""}
        </Button>
        {!open && (
          <span className="text-xs text-muted-foreground">
            Kept shut because it names students and why they were away — don&apos;t
            open it on a projector.
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
}
