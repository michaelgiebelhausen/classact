"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createAssignment } from "@/server/actions/assignments";
import type { TasteRequirement, TasteSource } from "@/lib/tastegrading";
import type { DeliverableType } from "@/lib/submissionfile";

/**
 * Professor: publish an assignment. Title + brief PDF + deadline — that's
 * the whole ask (zero-extra-effort principle). The AI drafts every
 * student's starting taste file from the brief on save.
 */

const ASSIGNMENT_BUCKET = "assignment-docs";

/** Assignments are due at the end of the chosen day, the way Canvas does it. */
const END_OF_DAY = "23:59";

/** "09:30" → "9:30 AM", for the class-start button's label. */
function formatClock(value: string): string {
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function AssignmentCreate({
  courseId,
  classStart,
}: {
  courseId: string;
  /** The course's meeting start as "HH:MM", when it has a schedule. */
  classStart?: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Day is the professor's to choose; the time starts where it almost
  // always ends up.
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState(END_OF_DAY);
  const [peerCloseDate, setPeerCloseDate] = useState("");
  const [peerCloseTime, setPeerCloseTime] = useState(END_OF_DAY);
  // Two axes: do students grade each other, and where the taste comes from.
  // Only the three supported cells are offered (peer-reviewed uses co-created
  // taste; the peer + instructor cell is deferred).
  const [peerReview, setPeerReview] = useState(true);
  const [tasteSource, setTasteSource] = useState<TasteSource>("cocreated");
  const selectCell = (peer: boolean, source: TasteSource) => {
    setPeerReview(peer);
    setTasteSource(source);
  };
  // Peer-reviewed co-created is today's "tasty" — the professor's taste file is
  // optional there. The two solo cells require it (it's the rubric, or what
  // students see + are measured against).
  const legacyTasty = peerReview && tasteSource === "cocreated";
  // The professor's PRIVATE AI grading criteria (ai_only mode). Not the
  // student-facing brief — that is `instructions` below.
  const [gradingCriteria, setGradingCriteria] = useState("");
  const [tasteRequirement, setTasteRequirement] =
    useState<TasteRequirement>("optional");
  // What students hand in. "any" = the default (every supported type).
  const [deliverableType, setDeliverableType] = useState<DeliverableType>("any");
  // 0033 — the student-facing brief. Students read this.
  const [instructions, setInstructions] = useState("");
  const [points, setPoints] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!title.trim()) {
      toast.error("Give the assignment a title.");
      return;
    }
    if (!deadlineDate) {
      toast.error("Pick a deadline date.");
      return;
    }
    if (!deadlineTime) {
      toast.error("Give the deadline a time.");
      return;
    }
    if (!legacyTasty && !gradingCriteria.trim()) {
      toast.error("This grading style needs your taste file — one sentence is enough.");
      return;
    }
    setSaving(true);
    let storagePath: string | null = null;
    if (file) {
      const supabase = createClient();
      const isMd =
        file.name.toLowerCase().endsWith(".md") || file.type === "text/markdown";
      storagePath = `${courseId}/brief/${crypto.randomUUID()}.${isMd ? "md" : "pdf"}`;
      const { error } = await supabase.storage
        .from(ASSIGNMENT_BUCKET)
        .upload(storagePath, file, {
          contentType: isMd ? "text/markdown" : "application/pdf",
        });
      if (error) {
        setSaving(false);
        toast.error("Upload failed — try again.");
        return;
      }
    }
    const result = await createAssignment({
      courseId,
      title,
      storagePath,
      deadline: new Date(`${deadlineDate}T${deadlineTime}`).toISOString(),
      peerCloseAt:
        peerReview && peerCloseDate
          ? new Date(
              `${peerCloseDate}T${peerCloseTime || END_OF_DAY}`
            ).toISOString()
          : null,
      peerReview,
      tasteSource,
      instructions,
      points,
      gradingInstructions: gradingCriteria || undefined,
      // tasteRequirement only applies to legacy tasty; the co-created lock is
      // its own requirement, and instructor-sourced has no student taste.
      tasteRequirement: legacyTasty ? tasteRequirement : undefined,
      deliverableType: deliverableType === "any" ? undefined : deliverableType,
    });
    setSaving(false);
    if (result.ok) {
      toast.success("Assignment published — students can start their taste files now.");
      setTitle("");
      setFile(null);
      setInstructions("");
      setPoints("");
      // Clear the days, keep the times at their defaults for the next one.
      setDeadlineDate("");
      setDeadlineTime(END_OF_DAY);
      setPeerCloseDate("");
      setPeerCloseTime(END_OF_DAY);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New assignment</CardTitle>
        <CardDescription>
          Upload the brief and set the deadline — the AI drafts each
          student&apos;s starting taste file, and grading runs itself from
          there. You get the final say before anything publishes. One
          assignment = one submitted PDF with one taste file — for
          multi-part work, publish each part as its own assignment so every
          part gets its own standard, rubric, and peer round.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="a-title">Title</Label>
          <Input
            id="a-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Case analysis 2: market entry"
            className="max-w-md"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="a-brief">Instructions (optional)</Label>
          <textarea
            id="a-brief"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What are they making, and what does done look like?"
            rows={5}
            maxLength={5000}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Students read this on the assignment. A brief PDF still works —
            you can use either, both, or neither.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="a-points">Points (optional)</Label>
          <Input
            id="a-points"
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
        <div className="grid gap-2">
          <Label>How is this graded?</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={legacyTasty ? "default" : "outline"}
              onClick={() => selectCell(true, "cocreated")}
            >
              Peer-reviewed
            </Button>
            <Button
              type="button"
              size="sm"
              variant={
                !peerReview && tasteSource === "cocreated" ? "default" : "outline"
              }
              onClick={() => selectCell(false, "cocreated")}
            >
              You grade · co-created taste
            </Button>
            <Button
              type="button"
              size="sm"
              variant={
                !peerReview && tasteSource === "instructor" ? "default" : "outline"
              }
              onClick={() => selectCell(false, "instructor")}
            >
              You grade · your taste
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {legacyTasty
              ? "Students grade each other's work. A rubric emerges from the whole class's taste files, and peers refine the AI's ranking."
              : tasteSource === "cocreated"
                ? "You're the only grader. Each student locks their own taste file first — that reveals yours and opens their upload — and the rubric is co-created from the class."
                : "You're the only grader. The AI grades every submission against your taste file — no student taste, no peer round."}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="a-grading-criteria">
            {legacyTasty
              ? "Your taste file (optional)"
              : "Your taste file (required — the standard students are shown and measured against)"}
          </Label>
          <textarea
            id="a-grading-criteria"
            value={gradingCriteria}
            onChange={(e) => setGradingCriteria(e.target.value)}
            placeholder={
              tasteSource === "instructor"
                ? "e.g. The screenshot must show a completed quiz with a visible score. 10 = 100%, scale down proportionally; 0 if no score is visible."
                : "What would make this work genuinely good? Write it the way you'd say it out loud."
            }
            rows={5}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            {legacyTasty
              ? "Private. It joins the class's taste files as one voice among many — the rubric that emerges must carry your themes through."
              : tasteSource === "cocreated"
                ? "Students see this once they've locked their own — and each student's taste is scored against it (the standards signal in their metrics)."
                : "There's no emergent rubric here — students are graded against this."}
          </p>
        </div>

        {legacyTasty && (
          <div className="grid gap-2">
            <Label htmlFor="a-taste-requirement">Students&apos; taste files</Label>
            <select
              id="a-taste-requirement"
              value={tasteRequirement}
              onChange={(e) =>
                setTasteRequirement(e.target.value as TasteRequirement)
              }
              className="h-9 max-w-md rounded-md border bg-background px-2 text-sm"
            >
              <option value="optional">Invited — they can write one</option>
              <option value="required">
                Required — part of the deliverable
              </option>
              <option value="off">Not this time — don&apos;t ask</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {tasteRequirement === "required"
                ? "They can't hand in the work until they've written what makes it good."
                : tasteRequirement === "off"
                  ? "No taste editor. The rubric emerges from your taste file and the AI's draft."
                  : "They're asked, not blocked — most classes start here."}
            </p>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="a-deliverable">What are students handing in?</Label>
          <select
            id="a-deliverable"
            value={deliverableType}
            onChange={(e) =>
              setDeliverableType(e.target.value as DeliverableType)
            }
            className="h-9 max-w-md rounded-md border bg-background px-2 text-sm"
          >
            <option value="any">Anything — PDF, Markdown, or image</option>
            <option value="pdf">A PDF</option>
            <option value="md">A Markdown file</option>
            <option value="image">A screenshot (PNG or JPG)</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {deliverableType === "image"
              ? "Students upload a screenshot and the AI assesses it visually against your taste file (e.g. counting what's shown). Screenshot grading needs a vision-capable model in AI Settings."
              : "Restricts what students can upload. Leave on “Anything” unless the deliverable has to be one specific format."}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label>Assignment brief (PDF or Markdown, optional)</Label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.md,text/markdown"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.size > 20 * 1024 * 1024) {
                  toast.error("Keep the brief under 20 MB.");
                } else if (f) {
                  setFile(f);
                }
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
            >
              {file ? file.name : "Choose file"}
            </Button>
          </div>
          {/* Date and time are separate controls so the time can carry a
              real default. A single datetime-local can't: it takes the time
              from the clock the moment you pick a day, which is never when
              anything is actually due. */}
          <div className="grid gap-2">
            <Label htmlFor="a-deadline-date">Deadline</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="a-deadline-date"
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="w-44"
              />
              <Input
                aria-label="Deadline time"
                type="time"
                value={deadlineTime}
                onChange={(e) => setDeadlineTime(e.target.value)}
                className="w-32"
              />
              {classStart && deadlineTime !== classStart && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setDeadlineTime(classStart)}
                >
                  Use class start ({formatClock(classStart)})
                </Button>
              )}
              {deadlineTime !== END_OF_DAY && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setDeadlineTime(END_OF_DAY)}
                >
                  Use 11:59 PM
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Pick the day — the time is already 11:59 PM.
            </p>
          </div>
          {peerReview && (
            <div className="grid gap-2">
              <Label htmlFor="a-peerclose-date">Peer grading ends (optional)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="a-peerclose-date"
                  type="date"
                  value={peerCloseDate}
                  onChange={(e) => setPeerCloseDate(e.target.value)}
                  className="w-44"
                />
                <Input
                  aria-label="Peer grading end time"
                  type="time"
                  value={peerCloseTime}
                  onChange={(e) => setPeerCloseTime(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          )}
        </div>
        <Button onClick={create} disabled={saving} className="w-fit">
          {saving ? "Publishing… (AI is drafting the taste file)" : "Publish assignment"}
        </Button>
      </CardContent>
    </Card>
  );
}
