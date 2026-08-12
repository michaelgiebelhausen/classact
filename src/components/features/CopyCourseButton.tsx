"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { duplicateCourse } from "@/server/actions/courses";
import { startCheckout } from "@/server/actions/billing";

/**
 * Copy a course — the same class at another hour. Lands on the new course's
 * setup so the meeting time (the usual reason for copying) is the first
 * thing in front of the professor.
 */
export function CopyCourseButton({
  courseId,
  courseName,
  term,
}: {
  courseId: string;
  courseName: string;
  term: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(courseName);
  const [copyDecks, setCopyDecks] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) {
      toast.error("Give the new section a name.");
      return;
    }
    setBusy(true);
    const result = await duplicateCourse({
      courseId,
      name,
      term: term ?? undefined,
      copyDecks,
    });
    setBusy(false);
    if (result.ok && result.data) {
      setOpen(false);
      toast.success(
        `Copied — ${result.data.seats} seats${
          result.data.decks > 0 ? `, ${result.data.decks} deck(s)` : ""
        }. Set the meeting time for this section.`
      );
      // Partial-copy warnings: anything that didn't come across, said plainly.
      for (const warning of result.data.warnings) {
        toast.warning(warning, { duration: 10000 });
      }
      router.push(`/course/${result.data.id}/setup`);
      router.refresh();
      return;
    }
    if (!result.ok && result.error === "billing_required") {
      toast.message(
        "ClassAct is $4.99/month — one subscription covers all your courses and sections. Taking you to checkout."
      );
      const checkout = await startCheckout();
      if (checkout.ok && checkout.data) {
        window.location.href = checkout.data.url;
      } else {
        toast.error(checkout.ok ? "Checkout unavailable." : checkout.error);
      }
      return;
    }
    toast.error(result.ok ? "Couldn't copy the course." : result.error);
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Copy
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy this course</DialogTitle>
            <DialogDescription>
              For another section of the same class. The room and seat map,
              schedule, icebreakers, and grading settings come across — the
              roster, check-ins, and grades stay with the original.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="copy-name">New course name</Label>
              <Input
                id="copy-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MKT4310 — Marketing Research (9:30 AM)"
              />
              <p className="text-xs text-muted-foreground">
                Name it so you can tell the sections apart — the meeting time
                usually does it.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={copyDecks}
                onChange={(e) => setCopyDecks(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Copy slide decks and their think-pair-share questions
                <span className="block text-xs text-muted-foreground">
                  Each section gets its own copy, so editing one won&apos;t
                  change the others.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Copying…" : "Create the copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
