"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Play, Presentation, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DECK_BUCKET } from "@/lib/storage";
import { createDeck, deleteDeck, startLecture } from "@/server/actions/lectures";
import { capture } from "@/lib/analytics";

const MAX_PDF_BYTES = 50 * 1024 * 1024; // Supabase default object limit

export interface DeckListItem {
  id: string;
  title: string;
  kind: "pdf" | "google_slides";
  pageCount: number | null;
  createdAt: string;
}

interface Props {
  courseId: string;
  decks: DeckListItem[];
}

/** Count pages locally so the deck row stores the real slide count. */
async function countPdfPages(file: File): Promise<number | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const doc = await loadingTask.promise;
    const pages = doc.numPages;
    void loadingTask.destroy();
    return pages;
  } catch {
    return null;
  }
}

export function DeckManager({ courseId, decks }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [slidesUrl, setSlidesUrl] = useState("");
  const [busyDeck, setBusyDeck] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("Export your deck as a PDF first (File → Export → PDF).");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("That PDF is over 50MB — compress it and try again.");
      return;
    }
    setUploading(true);
    try {
      const path = `${courseId}/${crypto.randomUUID()}.pdf`;
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(DECK_BUCKET)
        .upload(path, file, { contentType: "application/pdf" });
      if (uploadError) {
        toast.error("Upload failed — check your connection and try again.");
        return;
      }
      const pageCount = await countPdfPages(file);
      const title = file.name.replace(/\.pdf$/i, "");
      const result = await createDeck({
        courseId,
        title,
        kind: "pdf",
        storagePath: path,
        pageCount: pageCount ?? undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      capture("deck_uploaded", { pageCount });
      toast.success(`"${title}" is ready to present.`);
      router.refresh();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAddSlidesLink() {
    const url = slidesUrl.trim();
    if (!url) return;
    setUploading(true);
    try {
      const result = await createDeck({
        courseId,
        title: "Google Slides deck",
        kind: "google_slides",
        embedUrl: url,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSlidesUrl("");
      toast.success("Google Slides deck linked.");
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function handlePresent(deckId: string) {
    setBusyDeck(deckId);
    const result = await startLecture(courseId, deckId);
    setBusyDeck(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    capture("lecture_started", {});
    router.refresh();
  }

  async function handleDelete(deck: DeckListItem) {
    if (!window.confirm(`Delete "${deck.title}"? This can't be undone.`)) return;
    setBusyDeck(deck.id);
    const result = await deleteDeck(courseId, deck.id);
    setBusyDeck(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Deck deleted.");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a deck</CardTitle>
          <CardDescription>
            Upload your slides as a PDF — in PowerPoint or Google Slides use
            File → Export/Download → PDF. Synced presenting works on PDFs.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <FileText className="mr-2 size-4" />
              {uploading ? "Working…" : "Upload PDF deck"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="…or paste a Google Slides link (unsynced embed)"
              value={slidesUrl}
              onChange={(e) => setSlidesUrl(e.target.value)}
              className="max-w-md"
            />
            <Button
              variant="outline"
              onClick={() => void handleAddSlidesLink()}
              disabled={uploading || !slidesUrl.trim()}
            >
              Link slides
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your decks</CardTitle>
          <CardDescription>
            Hit Present to go live — students on the Follow Along page will
            sync to your current slide.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {decks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No decks yet — upload your first PDF above.
            </p>
          ) : (
            <ul className="grid gap-2">
              {decks.map((deck) => (
                <li
                  key={deck.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Presentation className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{deck.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {deck.kind === "pdf"
                          ? `PDF${deck.pageCount ? ` · ${deck.pageCount} slides` : ""}`
                          : "Google Slides (unsynced)"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void handlePresent(deck.id)}
                      disabled={busyDeck === deck.id}
                    >
                      <Play className="mr-1 size-4" /> Present
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleDelete(deck)}
                      disabled={busyDeck === deck.id}
                      aria-label={`Delete ${deck.title}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
