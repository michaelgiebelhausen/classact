"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AudioLines, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MATERIALS_BUCKET } from "@/lib/storage";
import { attachDeckTranscript, removeDeckTranscript } from "@/server/actions/polls";
import { capture } from "@/lib/analytics";

const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const ACCEPTED = /\.(txt|md|vtt)$/i;

interface Props {
  courseId: string;
  deckId: string;
  transcriptTitle: string | null;
}

/**
 * The deck's lecture-transcript control (one per deck). Text formats only —
 * every recorder (Pixel Recorder, Zoom, Panopto) exports .txt or .vtt, and
 * text lets Ask the TA read it without an extraction pass. Whether students
 * can download it is a course-level toggle, not per deck.
 */
export function DeckTranscript({ courseId, deckId, transcriptTitle }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (!ACCEPTED.test(file.name)) {
      toast.error("Transcripts need to be .txt, .md, or .vtt files.");
      return;
    }
    if (file.size > MAX_TRANSCRIPT_BYTES) {
      toast.error("That transcript is over 2MB — trim it and try again.");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "txt";
      const path = `${courseId}/transcript-${crypto.randomUUID()}.${ext}`;
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(MATERIALS_BUCKET)
        .upload(path, file, { contentType: "text/plain" });
      if (uploadError) {
        toast.error("Upload failed — check your connection and try again.");
        return;
      }
      const title = file.name.replace(ACCEPTED, "");
      const result = await attachDeckTranscript(courseId, deckId, path, title);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      capture("transcript_attached", {});
      toast.success("Transcript attached.");
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    const result = await removeDeckTranscript(courseId, deckId);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Transcript removed.");
    router.refresh();
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.md,.vtt,text/plain,text/markdown,text/vtt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {transcriptTitle ? (
        <Badge variant="secondary" className="max-w-56 gap-1">
          <AudioLines className="size-3" />
          <span className="truncate" title={transcriptTitle}>
            {transcriptTitle}
          </span>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={busy}
            aria-label="Remove transcript"
            className="ml-0.5 hover:text-destructive"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <AudioLines className="mr-1 size-4" />
          {busy ? "Uploading…" : "Attach transcript (.txt/.md/.vtt)"}
        </Button>
      )}
    </>
  );
}
