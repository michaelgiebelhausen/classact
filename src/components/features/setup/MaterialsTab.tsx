"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MATERIALS_BUCKET } from "@/lib/storage";
import {
  removeSyllabus,
  setSyllabus,
  updateTranscriptDownloads,
} from "@/server/actions/courses";
import { capture } from "@/lib/analytics";

const MAX_SYLLABUS_PDF_BYTES = 20 * 1024 * 1024;
const MAX_SYLLABUS_TEXT_BYTES = 2 * 1024 * 1024;
const ACCEPTED = /\.(pdf|txt|md)$/i;

interface Props {
  courseId: string;
  syllabusTitle: string | null;
  transcriptsDownloadable: boolean;
}

/**
 * Course materials settings: the syllabus (which mostly exists to feed Ask
 * the TA) and whether students may download lecture transcripts. The
 * transcripts themselves attach per deck on the Slides tab.
 */
export function MaterialsTab({
  courseId,
  syllabusTitle,
  transcriptsDownloadable,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [downloadable, setDownloadable] = useState(transcriptsDownloadable);
  const [savingToggle, setSavingToggle] = useState(false);

  async function handleFile(file: File) {
    if (!ACCEPTED.test(file.name)) {
      toast.error("The syllabus needs to be a PDF, .txt, or .md file.");
      return;
    }
    const isPdf = /\.pdf$/i.test(file.name);
    if (file.size > (isPdf ? MAX_SYLLABUS_PDF_BYTES : MAX_SYLLABUS_TEXT_BYTES)) {
      toast.error(isPdf ? "That PDF is over 20MB." : "That file is over 2MB.");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
      const path = `${courseId}/syllabus-${crypto.randomUUID()}.${ext}`;
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(MATERIALS_BUCKET)
        .upload(path, file, {
          contentType: isPdf ? "application/pdf" : "text/plain",
        });
      if (uploadError) {
        toast.error("Upload failed — check your connection and try again.");
        return;
      }
      const title = file.name.replace(ACCEPTED, "");
      const result = await setSyllabus(courseId, path, title);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      capture("syllabus_uploaded", {});
      toast.success(
        isPdf
          ? "Syllabus uploaded — index it on the Ask TA page so the TA can read it."
          : "Syllabus uploaded — the TA can read it now."
      );
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    const result = await removeSyllabus(courseId);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Syllabus removed.");
    router.refresh();
  }

  async function toggleDownloads(next: boolean) {
    setDownloadable(next);
    setSavingToggle(true);
    const result = await updateTranscriptDownloads(courseId, next);
    setSavingToggle(false);
    if (!result.ok) {
      setDownloadable(!next);
      toast.error(result.error);
      return;
    }
    toast.success(
      next
        ? "Students can download transcripts."
        : "Transcript downloads are off — the TA can still read them."
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Syllabus</CardTitle>
          <CardDescription>
            Ask the TA leans on this constantly — every &quot;when is it
            due?&quot; and &quot;what&apos;s the late policy?&quot; answer
            starts here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {syllabusTitle ? (
            <Badge variant="secondary" className="max-w-72 gap-1">
              <FileText className="size-3" />
              <span className="truncate" title={syllabusTitle}>
                {syllabusTitle}
              </span>
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={busy}
                aria-label="Remove syllabus"
                className="ml-0.5 hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <FileText className="mr-1 size-4" />
              {busy ? "Uploading…" : "Upload syllabus (.pdf/.txt/.md)"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lecture transcripts</CardTitle>
          <CardDescription>
            Attach transcripts to each deck on the Slides tab. This controls
            whether students can download them; Ask the TA reads them either
            way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={downloadable}
              disabled={savingToggle}
              onChange={(e) => void toggleDownloads(e.target.checked)}
            />
            Students can download transcripts
          </label>
        </CardContent>
      </Card>
    </div>
  );
}
