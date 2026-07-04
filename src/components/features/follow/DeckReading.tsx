"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DECK_BUCKET } from "@/lib/storage";
import { attachDeckReading, removeDeckReading } from "@/server/actions/polls";
import { capture } from "@/lib/analytics";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

interface Props {
  courseId: string;
  deckId: string;
  readingTitle: string | null;
}

/**
 * The deck's Reading/Reference PDF control (one per deck — combine readings
 * in Acrobat). Sits in the deck's title row; AI question generation draws on
 * the attached reading alongside the slides.
 */
export function DeckReading({ courseId, deckId, readingTitle }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("The reading needs to be a PDF (combine files in Acrobat).");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("That PDF is over 50MB — compress it and try again.");
      return;
    }
    setBusy(true);
    try {
      const path = `${courseId}/reading-${crypto.randomUUID()}.pdf`;
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(DECK_BUCKET)
        .upload(path, file, { contentType: "application/pdf" });
      if (uploadError) {
        toast.error("Upload failed — check your connection and try again.");
        return;
      }
      const title = file.name.replace(/\.pdf$/i, "");
      const result = await attachDeckReading(courseId, deckId, path, title);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      capture("reading_attached", {});
      toast.success("Reading attached — AI questions will draw on it too.");
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    const result = await removeDeckReading(courseId, deckId);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Reading removed.");
    router.refresh();
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {readingTitle ? (
        <Badge variant="secondary" className="max-w-56 gap-1">
          <BookOpen className="size-3" />
          <span className="truncate" title={readingTitle}>
            {readingTitle}
          </span>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={busy}
            aria-label="Remove reading"
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
          <BookOpen className="mr-1 size-4" />
          {busy ? "Uploading…" : "Attach reading/reference PDF"}
        </Button>
      )}
    </>
  );
}
