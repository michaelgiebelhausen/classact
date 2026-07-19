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
    setSaving(true);
    let storagePath: string | null = null;
    if (file) {
      const supabase = createClient();
      storagePath = `${courseId}/brief/${crypto.randomUUID()}.pdf`;
      const { error } = await supabase.storage
        .from(ASSIGNMENT_BUCKET)
        .upload(storagePath, file, { contentType: "application/pdf" });
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
      peerCloseAt: peerClose ? new Date(peerClose).toISOString() : null,
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
          there. You get the final say before anything publishes.
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
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label>Assignment brief (PDF, optional)</Label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
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
              {file ? file.name : "Choose PDF"}
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
        </div>
        <Button onClick={create} disabled={saving} className="w-fit">
          {saving ? "Publishing… (AI is drafting the taste file)" : "Publish assignment"}
        </Button>
      </CardContent>
    </Card>
  );
}
