"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, GripVertical, Play, Presentation, Trash2 } from "lucide-react";
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
import {
  createDeck,
  deleteDeck,
  reorderDecks,
  startLecture,
} from "@/server/actions/lectures";
import {
  DeckQuestions,
  type QuestionItem,
} from "@/components/features/follow/DeckQuestions";
import { DeckReading } from "@/components/features/follow/DeckReading";
import { DeckTranscript } from "@/components/features/follow/DeckTranscript";
import { capture } from "@/lib/analytics";

const MAX_PDF_BYTES = 50 * 1024 * 1024; // Supabase default object limit

type DeckSort = "custom" | "newest" | "oldest";

const SORT_OPTIONS: { value: DeckSort; label: string }[] = [
  { value: "custom", label: "My order" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

const SORT_HINTS: Record<DeckSort, string> = {
  custom:
    "Drag the handle to put them in the order you teach them. New uploads land at the top.",
  newest: "Sorted by date added, newest at the top — new uploads land there.",
  oldest:
    "Sorted by date added, oldest at the top — new uploads land at the bottom.",
};

export interface DeckListItem {
  id: string;
  title: string;
  kind: "pdf" | "google_slides";
  pageCount: number | null;
  createdAt: string;
  readingTitle: string | null;
  transcriptTitle: string | null;
  questions: QuestionItem[];
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

  // Local order so a drag lands instantly, reconciled during render
  // whenever the server sends a new list (upload, delete, saved reorder).
  const [order, setOrder] = useState<DeckListItem[]>(decks);
  const [serverDecks, setServerDecks] = useState(decks);
  if (serverDecks !== decks) {
    setServerDecks(decks);
    setOrder(decks);
  }
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragArmed, setDragArmed] = useState(false);

  // Display sort for this list. "custom" is the drag order stored on the
  // server; the date sorts are per-professor display preferences, so they
  // live in localStorage rather than the course row. Read after mount so
  // the server-rendered HTML (always "custom") matches on hydration.
  const [sort, setSort] = useState<DeckSort>("custom");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`classact:deck-sort:${courseId}`);
      if (saved === "newest" || saved === "oldest" || saved === "custom") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading back a preference the browser stored is exactly the external-system sync effects are for; it runs once per course.
        setSort(saved);
      }
    } catch {
      // localStorage unavailable — keep the default
    }
  }, [courseId]);

  function changeSort(next: DeckSort) {
    setSort(next);
    try {
      window.localStorage.setItem(`classact:deck-sort:${courseId}`, next);
    } catch {
      // fine — the choice just won't stick across visits
    }
  }

  // created_at is an ISO timestamp, so string comparison sorts correctly.
  const visibleDecks =
    sort === "custom"
      ? order
      : [...order].sort((a, b) =>
          sort === "newest"
            ? b.createdAt.localeCompare(a.createdAt)
            : a.createdAt.localeCompare(b.createdAt)
        );

  function moveDeck(from: number, to: number) {
    if (from === to || to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    void reorderDecks(
      courseId,
      next.map((d) => d.id)
    ).then((result) => {
      if (!result.ok) {
        toast.error(result.error);
        setOrder(decks); // put it back where the server still has it
      } else {
        router.refresh();
      }
    });
  }

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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1.5">
              <CardTitle>Your decks</CardTitle>
              <CardDescription>
                Hit Present to go live — students on the Follow Along page
                will sync to your current slide. {SORT_HINTS[sort]}
              </CardDescription>
            </div>
            <div
              role="group"
              aria-label="Sort decks"
              className="flex shrink-0 items-center gap-1 rounded-md border p-0.5"
            >
              {SORT_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={sort === option.value ? "secondary" : "ghost"}
                  aria-pressed={sort === option.value}
                  onClick={() => changeSort(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {decks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No decks yet — upload your first PDF above.
            </p>
          ) : (
            <ul className="grid gap-2">
              {visibleDecks.map((deck, index) => (
                <li
                  key={deck.id}
                  draggable={dragArmed && sort === "custom"}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => {
                    if (dragIndex !== null && dragIndex !== index) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) moveDeck(dragIndex, index);
                    setDragIndex(null);
                    setDragArmed(false);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragArmed(false);
                  }}
                  className={[
                    "rounded-lg border px-4 py-3 transition-colors",
                    dragIndex === index ? "opacity-50" : "",
                    dragIndex !== null && dragIndex !== index
                      ? "border-dashed hover:border-primary"
                      : "",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {sort === "custom" && (
                      <button
                        type="button"
                        aria-label={`Reorder ${deck.title}. Use arrow keys to move it.`}
                        onMouseDown={() => setDragArmed(true)}
                        onMouseUp={() => setDragArmed(false)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            moveDeck(index, index - 1);
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            moveDeck(index, index + 1);
                          }
                        }}
                        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                      >
                        <GripVertical className="size-4" />
                      </button>
                      )}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <DeckReading
                        courseId={courseId}
                        deckId={deck.id}
                        readingTitle={deck.readingTitle}
                      />
                      <DeckTranscript
                        courseId={courseId}
                        deckId={deck.id}
                        transcriptTitle={deck.transcriptTitle}
                      />
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
                  </div>
                  <DeckQuestions
                    courseId={courseId}
                    deckId={deck.id}
                    deckKind={deck.kind}
                    pageCount={deck.pageCount}
                    readingTitle={deck.readingTitle}
                    questions={deck.questions}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
