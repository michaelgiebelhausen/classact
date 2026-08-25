"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAssignment } from "@/server/actions/assignments";
import type { AssignmentState } from "@/types/db";

/**
 * Edit an assignment after it exists. The rules mirror the server action:
 * title always; deadline only while submissions are open; peer-grading
 * close while open or during peer review. Fields outside those windows
 * render disabled with the reason, so the professor sees why rather than
 * hunting for a control that isn't there.
 */

interface Props {
  assignmentId: string;
  state: AssignmentState;
  title: string;
  /** ISO datetimes. */
  deadline: string;
  peerCloseAt: string;
}

function toLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function AssignmentEdit({
  assignmentId,
  state,
  title: initialTitle,
  deadline,
  peerCloseAt,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const dl = toLocalParts(deadline);
  const pc = toLocalParts(peerCloseAt);
  const [dlDate, setDlDate] = useState(dl.date);
  const [dlTime, setDlTime] = useState(dl.time);
  const [pcDate, setPcDate] = useState(pc.date);
  const [pcTime, setPcTime] = useState(pc.time);

  const canEditDeadline = state === "open";
  const canEditPeerClose = state === "open" || state === "peer_review";

  async function save() {
    const input: Parameters<typeof updateAssignment>[0] = { assignmentId };
    if (title.trim() !== initialTitle) input.title = title;
    if (canEditDeadline && (dlDate !== dl.date || dlTime !== dl.time)) {
      const next = new Date(`${dlDate}T${dlTime}`);
      if (Number.isNaN(next.getTime())) {
        toast.error("That deadline isn't a valid date and time.");
        return;
      }
      input.deadline = next.toISOString();
    }
    if (canEditPeerClose && (pcDate !== pc.date || pcTime !== pc.time)) {
      const next = new Date(`${pcDate}T${pcTime}`);
      if (Number.isNaN(next.getTime())) {
        toast.error("That peer grading close isn't a valid date and time.");
        return;
      }
      input.peerCloseAt = next.toISOString();
    }
    if (
      input.title === undefined &&
      input.deadline === undefined &&
      input.peerCloseAt === undefined
    ) {
      setOpen(false);
      return;
    }

    setSaving(true);
    let result: Awaited<ReturnType<typeof updateAssignment>>;
    try {
      result = await updateAssignment(input);
    } catch {
      toast.error("Couldn't reach the server — try again.");
      return;
    } finally {
      setSaving(false);
    }
    if (result.ok) {
      toast.success("Assignment updated.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="mr-2 size-4" /> Edit assignment
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-1.5">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="max-w-md"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit-deadline-date">Submission deadline</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="edit-deadline-date"
              type="date"
              value={dlDate}
              onChange={(e) => setDlDate(e.target.value)}
              disabled={!canEditDeadline}
              className="max-w-[160px]"
            />
            <Input
              type="time"
              value={dlTime}
              onChange={(e) => setDlTime(e.target.value)}
              disabled={!canEditDeadline}
              className="max-w-[120px]"
            />
          </div>
          {!canEditDeadline && (
            <p className="text-xs text-muted-foreground">
              The deadline is locked once grading starts — it&apos;s baked
              into the analysis.
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit-peer-date">Peer grading closes</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="edit-peer-date"
              type="date"
              value={pcDate}
              onChange={(e) => setPcDate(e.target.value)}
              disabled={!canEditPeerClose}
              className="max-w-[160px]"
            />
            <Input
              type="time"
              value={pcTime}
              onChange={(e) => setPcTime(e.target.value)}
              disabled={!canEditPeerClose}
              className="max-w-[120px]"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {canEditPeerClose
              ? state === "peer_review"
                ? "Extend it to give judges more time — or move it to a minute from now to close peer grading early."
                : "Must be after the submission deadline."
              : "Peer grading has already closed."}
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
