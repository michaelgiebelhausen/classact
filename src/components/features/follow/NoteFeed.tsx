"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  NoteEntryItem,
  type NoteEntryData,
} from "@/components/features/notes/NoteEntryItem";
import { addNoteEntry } from "@/server/actions/notes";

interface Props {
  courseId: string;
  lectureId: string;
  /** The slide the professor is on right now. */
  page: number;
  initialEntries: NoteEntryData[];
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** Where an unsent draft waits out a closed tab. */
function draftKey(lectureId: string): string {
  return `classact:note-draft:${lectureId}`;
}

export function NoteFeed({ courseId, lectureId, page, initialEntries }: Props) {
  const [entries, setEntries] = useState<NoteEntryData[]>(initialEntries);
  const [draft, setDraft] = useState("");
  const [draftPage, setDraftPage] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const draftRef = useRef("");
  const draftPageRef = useRef<number | null>(null);
  const pageRef = useRef(page);
  // Only a draft the student actually typed is worth auto-committing on the
  // way out. A draft merely restored from storage is left alone — which also
  // keeps React's development double-mount from saving it twice.
  const typedRef = useRef(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  // The commit callback is stable, so it reads the live slide from a ref
  // rather than closing over a stale one.
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  // The stamp follows the live slide until they start typing; from the first
  // character it holds, because the note belongs to the slide that prompted
  // it, not to wherever the professor has moved on to by the time it's sent.
  const stamp = draft.trim() ? (draftPage ?? page) : page;

  const setDraftText = useCallback((value: string) => {
    const hadText = draftRef.current.trim().length > 0;
    const hasText = value.trim().length > 0;
    if (!hadText && hasText) {
      draftPageRef.current = pageRef.current;
      setDraftPage(pageRef.current);
    } else if (!hasText) {
      draftPageRef.current = null;
      setDraftPage(null);
    }
    draftRef.current = value;
    typedRef.current = true;
    setDraft(value);
  }, []);

  const commit = useCallback(async () => {
    const text = draftRef.current.trim();
    if (!text) return;
    const stampedPage = draftPageRef.current ?? pageRef.current;

    const tempId = `pending-${crypto.randomUUID()}`;
    const optimistic: NoteEntryData = {
      id: tempId,
      page: stampedPage,
      content: text,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setEntries((prev) => [...prev, optimistic]);

    draftRef.current = "";
    draftPageRef.current = null;
    typedRef.current = false;
    setDraft("");
    setDraftPage(null);
    setSaveState("saving");
    try {
      localStorage.removeItem(draftKey(lectureId));
    } catch {
      // Private browsing, blocked storage — the note itself is what matters.
    }

    const result = await addNoteEntry(courseId, lectureId, stampedPage, text);
    if (!result.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== tempId));
      setSaveState("error");
      toast.error(result.error);
      // Give them their words back rather than making them retype.
      if (!draftRef.current.trim()) {
        draftRef.current = text;
        draftPageRef.current = stampedPage;
        typedRef.current = true;
        setDraft(text);
        setDraftPage(stampedPage);
      }
      return;
    }

    const saved = result.data;
    setEntries((prev) =>
      prev.map((e) =>
        e.id === tempId && saved
          ? {
              id: saved.id,
              page: saved.page,
              content: saved.content,
              createdAt: saved.createdAt,
            }
          : e
      )
    );
    setSaveState("saved");
  }, [courseId, lectureId]);

  // Restore whatever a closed tab left behind. This has to happen after mount
  // rather than in a lazy initializer: localStorage doesn't exist during the
  // server render, and seeding it on the client's first render would disagree
  // with the HTML the server sent.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(draftKey(lectureId));
      if (!stored) return;
      const parsed = JSON.parse(stored) as { page?: number; content?: string };
      if (typeof parsed.content === "string" && parsed.content.trim()) {
        draftRef.current = parsed.content;
        const restoredPage =
          typeof parsed.page === "number" ? parsed.page : null;
        draftPageRef.current = restoredPage;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading back a draft the browser stored is exactly the external-system sync effects are for; it runs once per lecture.
        setDraft(parsed.content);
        setDraftPage(restoredPage);
      }
    } catch {
      // A malformed draft is not worth breaking the lecture over.
    }
  }, [lectureId]);

  // A tab can be closed or backgrounded without warning, and a server action
  // is a fetch that may not outlive it. Mirroring to storage is synchronous,
  // so it always completes.
  useEffect(() => {
    const mirror = () => {
      const text = draftRef.current;
      try {
        if (text.trim()) {
          localStorage.setItem(
            draftKey(lectureId),
            JSON.stringify({ page: draftPageRef.current, content: text })
          );
        } else {
          localStorage.removeItem(draftKey(lectureId));
        }
      } catch {
        // Nothing to do; the draft stays on screen.
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") mirror();
    };
    window.addEventListener("pagehide", mirror);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", mirror);
      document.removeEventListener("visibilitychange", onHide);
      mirror();
    };
  }, [lectureId]);

  // Leaving the page in-app: the tab is alive, so the draft can be saved
  // properly rather than parked in storage.
  useEffect(() => {
    return () => {
      if (typedRef.current && draftRef.current.trim()) void commit();
    };
  }, [commit]);

  // New notes land at the bottom; keep them in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length]);

  const statusLine =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Save failed — keep a copy!"
        : saveState === "saved"
          ? "Saved to your account"
          : "Saved to your account as you go — nobody else can read these";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <NotebookPen className="size-4" /> My notes
            </CardTitle>
            <CardDescription>{statusLine}</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/course/${courseId}/notes`}>View all notes</Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        {entries.length > 0 ? (
          <ul
            ref={listRef}
            className="grid max-h-72 gap-2 overflow-y-auto pr-1"
          >
            {entries.map((entry) => (
              <NoteEntryItem
                key={entry.id}
                courseId={courseId}
                entry={entry}
                onUpdated={(id, content) =>
                  setEntries((prev) =>
                    prev.map((e) => (e.id === id ? { ...e, content } : e))
                  )
                }
                onDeleted={(id) =>
                  setEntries((prev) => prev.filter((e) => e.id !== id))
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Notes you take here are saved to your account and stamped with the
            slide you were on. You can export them as Markdown or email them to
            yourself anytime.
          </p>
        )}

        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              Slide {stamp}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Enter saves · Shift+Enter for a new line
            </span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void commit();
              }
            }}
            placeholder="Type a note and press Enter…"
            className="min-h-20 w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => void commit()}
              disabled={!draft.trim()}
            >
              Add note
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
