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

/**
 * Professor: publish an assignment. Title + brief PDF + deadline — that's
 * the whole ask (zero-extra-effort principle). The AI drafts every
 * student's starting taste file from the brief on save.
 */

const ASSIGNMENT_BUCKET = "assignment-docs";

export function AssignmentCreate({ courseId }: { courseId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [deadline, setDeadline] = useState("");
  const [peerClose, setPeerClose] = useState("");
  const [gradingMode, setGradingMode] = useState<"tasty" | "ai_only">("tasty");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!title.trim()) {
      toast.error("Give the assignment a title.");
      return;
    }
    if (!deadline) {
      toast.error("Pick a deadline.");
      return;
    }
    if (gradingMode === "ai_only" && !instructions.trim()) {
      toast.error(
        "AI-only grading needs your criteria — one sentence is enough."
      );
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
      deadline: new Date(deadline).toISOString(),
      peerCloseAt:
        gradingMode === "tasty" && peerClose
          ? new Date(peerClose).toISOString()
          : null,
      gradingMode,
      gradingInstructions: gradingMode === "ai_only" ? instructions : undefined,
    });
    setSaving(false);
    if (result.ok) {
      toast.success("Assignment published — students can start their taste files now.");
      setTitle("");
      setFile(null);
      setDeadline("");
      setPeerClose("");
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
          <Label>Grading mode</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={gradingMode === "tasty" ? "default" : "outline"}
              onClick={() => setGradingMode("tasty")}
            >
              Tasty Grading (peers + AI)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={gradingMode === "ai_only" ? "default" : "outline"}
              onClick={() => setGradingMode("ai_only")}
            >
              AI-only (no peer review)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {gradingMode === "tasty"
              ? "Students write taste files, a rubric emerges from the class, and peers refine the AI's ranking."
              : "For objective work (quiz screenshots, checklists): the AI grades every submission against your criteria — no taste files, no peer round. You still review and publish."}
          </p>
        </div>

        {gradingMode === "ai_only" && (
          <div className="grid gap-2">
            <Label htmlFor="a-instructions">
              Your grading criteria (required — this is the standard the AI
              grades against)
            </Label>
            <textarea
              id="a-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={
                "e.g. The screenshot must show a completed quiz with a visible score. 10 = 100%, scale down proportionally; 0 if no score is visible."
              }
              rows={3}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        )}

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
          <div className="grid gap-2">
            <Label htmlFor="a-deadline">Deadline</Label>
            <Input
              id="a-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-56"
            />
          </div>
          {gradingMode === "tasty" && (
            <div className="grid gap-2">
              <Label htmlFor="a-peerclose">Peer grading ends (optional)</Label>
              <Input
                id="a-peerclose"
                type="datetime-local"
                value={peerClose}
                onChange={(e) => setPeerClose(e.target.value)}
                className="w-56"
              />
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
