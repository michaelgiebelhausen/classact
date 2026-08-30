"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveProfessorTaste,
  setGradingOptions,
  updateAssignment,
} from "@/server/actions/assignments";
import type { TasteRequirement } from "@/lib/tastegrading";
import type { AssignmentState } from "@/types/db";

const ASSIGNMENT_BUCKET = "assignment-docs";

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
  /** 0033 — student-facing brief. NOT the ai_only grading criteria. */
  instructions: string;
  /** 0033 — null means no point value set, which isn't zero. */
  points: number | null;
  /** ISO datetimes. */
  deadline: string;
  peerCloseAt: string;
  /** Shapes the taste-file label and whether it may be emptied. */
  gradingMode: "tasty" | "ai_only";
  /** The professor's own taste file, as prose (empty if none written). */
  professorTaste: string;
  /** Whether a student taste file is invited, required, or off (tasty only). */
  tasteRequirement: TasteRequirement;
  /** For uploading a replacement brief to `{courseId}/brief/…`. */
  courseId: string;
  /** Signed URL to view the currently attached brief, or null if none. */
  briefUrl: string | null;
  /** The current brief's extension ("pdf" | "md"), for the label. */
  briefExt: string | null;
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
  instructions: initialInstructions,
  points: initialPoints,
  deadline,
  peerCloseAt,
  gradingMode,
  professorTaste: initialTaste,
  tasteRequirement: initialTasteReq,
  courseId,
  briefUrl,
  briefExt,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const initialPointsText = initialPoints === null ? "" : String(initialPoints);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [points, setPoints] = useState(initialPointsText);
  const [taste, setTaste] = useState(initialTaste);
  const [tasteReq, setTasteReq] = useState(initialTasteReq);
  // Brief file swap: a chosen replacement, or an explicit "remove". The
  // current file itself lives in storage — only the pointer changes here.
  const briefRef = useRef<HTMLInputElement>(null);
  const [briefFile, setBriefFile] = useState<File | null>(null);
  const [removeBrief, setRemoveBrief] = useState(false);
  const dl = toLocalParts(deadline);
  const pc = toLocalParts(peerCloseAt);
  const [dlDate, setDlDate] = useState(dl.date);
  const [dlTime, setDlTime] = useState(dl.time);
  const [pcDate, setPcDate] = useState(pc.date);
  const [pcTime, setPcTime] = useState(pc.time);

  const canEditDeadline = state === "open";
  const canEditPeerClose = state === "open" || state === "peer_review";
  // The rubric is emerged from the taste file at the deadline, so a later
  // edit would change nothing and quietly imply it had — the server refuses
  // it too. Locked exactly like the deadline once grading starts.
  const canEditTaste = state === "open";
  // Whether a student taste file is required closes with submissions: changing
  // what the deliverable includes after they've handed it in would fail people
  // retroactively (the server enforces the same window).
  const canEditTasteReq = state === "open";

  async function save() {
    const input: Parameters<typeof updateAssignment>[0] = { assignmentId };
    if (title.trim() !== initialTitle) input.title = title;
    // Neither is state-gated: unlike the deadline, a typo in the brief or
    // the point value is worth fixing at any point in the lifecycle.
    if (instructions !== initialInstructions) input.instructions = instructions;
    if (points !== initialPointsText) input.points = points;
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
    // The taste file rides a separate action (it lives in its own table), so
    // track its change independently. Comparing trimmed, since both the seed
    // and the saved body are trimmed — trailing whitespace isn't a change.
    const tasteChanged =
      canEditTaste && taste.trim() !== initialTaste.trim();

    // The taste requirement rides setGradingOptions, and only exists in tasty
    // mode (ai_only has no student taste files).
    const tasteReqChanged =
      gradingMode === "tasty" &&
      canEditTasteReq &&
      tasteReq !== initialTasteReq;

    // The brief file: replace it (a new one chosen) or remove it (explicitly
    // cleared). The upload itself waits until we're actually saving.
    const briefIntent: "replace" | "remove" | "none" = briefFile
      ? "replace"
      : removeBrief
        ? "remove"
        : "none";

    // Assignment fields untouched when only assignmentId is present. Counting
    // keys rather than naming fields, so a new field can't be forgotten here
    // and silently fail to save.
    const fieldsChanged = Object.keys(input).length > 1;
    if (
      !fieldsChanged &&
      !tasteChanged &&
      !tasteReqChanged &&
      briefIntent === "none"
    ) {
      setOpen(false);
      return;
    }

    // In ai_only mode the taste file IS the rubric students are graded
    // against — it can't be blanked. (The server refuses this too.)
    if (tasteChanged && gradingMode === "ai_only" && !taste.trim()) {
      toast.error(
        "AI-only grading needs your taste file — it's the standard students are graded against."
      );
      return;
    }

    setSaving(true);
    try {
      // Upload the replacement first, so storage_path only moves once the
      // bytes are actually up. The path shape matches AssignmentCreate.
      if (briefIntent === "replace" && briefFile) {
        const supabase = createClient();
        const isMd =
          briefFile.name.toLowerCase().endsWith(".md") ||
          briefFile.type === "text/markdown";
        const path = `${courseId}/brief/${crypto.randomUUID()}.${isMd ? "md" : "pdf"}`;
        const { error } = await supabase.storage
          .from(ASSIGNMENT_BUCKET)
          .upload(path, briefFile, {
            contentType: isMd ? "text/markdown" : "application/pdf",
          });
        if (error) {
          toast.error("Upload failed — try again.");
          return;
        }
        input.storagePath = path;
      } else if (briefIntent === "remove") {
        input.storagePath = null;
      }

      // Re-check after the brief may have added a key: a brief-only change
      // still needs updateAssignment, but a taste-only change doesn't.
      if (Object.keys(input).length > 1) {
        const result = await updateAssignment(input);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
      }
      if (tasteChanged) {
        const result = await saveProfessorTaste(assignmentId, taste);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
      }
      if (tasteReqChanged) {
        const result = await setGradingOptions(assignmentId, {
          tasteRequirement: tasteReq,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
      }
    } catch {
      toast.error("Couldn't reach the server — try again.");
      return;
    } finally {
      setSaving(false);
    }
    setBriefFile(null);
    setRemoveBrief(false);
    toast.success("Assignment updated.");
    setOpen(false);
    router.refresh();
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
          <Label htmlFor="edit-instructions">Instructions</Label>
          <textarea
            id="edit-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={5}
            maxLength={5000}
            placeholder="What are they making, and what does done look like?"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Students read this. Editable at any point — it isn&apos;t baked
            into the analysis the way the deadline is.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label>Brief file</Label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {briefFile ? (
              <span className="text-muted-foreground">
                New file:{" "}
                <span className="font-medium text-foreground">
                  {briefFile.name}
                </span>
              </span>
            ) : removeBrief ? (
              <span className="text-muted-foreground">
                The current file will be removed when you save.
              </span>
            ) : briefUrl ? (
              <a
                href={briefUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary underline"
              >
                <FileText className="size-4" />
                View current {briefExt === "md" ? "Markdown" : "PDF"}
              </a>
            ) : (
              <span className="text-muted-foreground">
                No brief file uploaded.
              </span>
            )}
          </div>
          <input
            ref={briefRef}
            type="file"
            accept="application/pdf,.md,text/markdown"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size > 20 * 1024 * 1024) {
                toast.error("Keep the brief under 20 MB.");
              } else if (f) {
                setBriefFile(f);
                setRemoveBrief(false);
              }
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => briefRef.current?.click()}
            >
              {briefUrl || briefFile ? "Replace file" : "Upload file"}
            </Button>
            {briefFile && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setBriefFile(null)}
              >
                Undo
              </Button>
            )}
            {!briefFile && briefUrl && !removeBrief && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setRemoveBrief(true)}
              >
                Remove file
              </Button>
            )}
            {removeBrief && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setRemoveBrief(false)}
              >
                Keep file
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PDF or Markdown, up to 20 MB. Replace it if the wrong file went up —
            students see the new one right away.
            {gradingMode === "tasty" && state === "open"
              ? " The AI drafted each student's starting taste file from the original brief; swapping the file here doesn't redraw that."
              : ""}
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit-points">Points</Label>
          <Input
            id="edit-points"
            type="number"
            min="0"
            step="any"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="max-w-[140px]"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank if this assignment isn&apos;t worth points.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit-taste">
            {gradingMode === "ai_only"
              ? "Your taste file (the standard the AI grades against)"
              : "Your taste file"}
          </Label>
          <textarea
            id="edit-taste"
            value={taste}
            onChange={(e) => setTaste(e.target.value)}
            disabled={!canEditTaste}
            rows={5}
            maxLength={10000}
            placeholder={
              gradingMode === "ai_only"
                ? "e.g. The screenshot must show a completed quiz with a visible score. 10 = 100%, scale down proportionally; 0 if no score is visible."
                : "What would make this work genuinely good? Write it the way you'd say it out loud."
            }
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">
            {!canEditTaste
              ? "Locked — the rubric was already drawn from this at the deadline."
              : gradingMode === "ai_only"
                ? "There's no emergent rubric in AI-only mode, so students are shown this — it's the standard every submission is graded against."
                : "Private. It joins the class's taste files as one voice among many — the rubric that emerges must carry your themes through."}
          </p>
        </div>

        {gradingMode === "tasty" && (
          <div className="grid gap-1.5">
            <Label htmlFor="edit-taste-req">Students&apos; taste files</Label>
            <select
              id="edit-taste-req"
              value={tasteReq}
              onChange={(e) => setTasteReq(e.target.value as TasteRequirement)}
              disabled={!canEditTasteReq}
              className="h-9 max-w-md rounded-md border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="optional">Invited — they can write one</option>
              <option value="required">
                Required — part of the deliverable
              </option>
              <option value="off">Not this time — don&apos;t ask</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {!canEditTasteReq
                ? "Submissions have closed — what the deliverable includes can't change now."
                : tasteReq === "required"
                  ? "They can't hand in the work until they've written what makes it good."
                  : tasteReq === "off"
                    ? "No taste editor. The rubric emerges from your taste file and the AI's draft."
                    : "They're asked, not blocked — most classes start here."}
            </p>
          </div>
        )}

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
