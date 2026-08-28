"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/localtime";
import { deleteNoteEntry, updateNoteEntry } from "@/server/actions/notes";
import { cn } from "@/lib/utils";

export interface NoteEntryData {
  id: string;
  /** Slide on screen when it was typed; null for notes imported from the old box. */
  page: number | null;
  content: string;
  createdAt: string;
  /** True while the insert is still in flight, so the row can look provisional. */
  pending?: boolean;
}

interface Props {
  courseId: string;
  entry: NoteEntryData;
  onUpdated: (id: string, content: string) => void;
  onDeleted: (id: string) => void;
  /** The archive already groups by slide, so it hides the per-entry badge. */
  showSlide?: boolean;
}

export function NoteEntryItem({
  courseId,
  entry,
  onUpdated,
  onDeleted,
  showSlide = true,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save() {
    const text = draft.trim();
    if (!text || text === entry.content) {
      setEditing(false);
      setDraft(entry.content);
      return;
    }
    setBusy(true);
    const result = await updateNoteEntry(courseId, entry.id, text);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onUpdated(entry.id, text);
    setEditing(false);
  }

  async function remove() {
    setBusy(true);
    const result = await deleteNoteEntry(courseId, entry.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      setConfirmingDelete(false);
      return;
    }
    onDeleted(entry.id);
  }

  if (editing) {
    return (
      <li className="rounded-lg border bg-muted/30 p-2">
        <textarea
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") {
              setDraft(entry.content);
              setEditing(false);
            }
          }}
          className="min-h-16 w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-1 flex items-center gap-1">
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            <Check className="size-3.5" /> Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(entry.content);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            Enter saves · Esc cancels
          </span>
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group rounded-lg border p-2 text-sm",
        entry.pending && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {showSlide && (
              <Badge variant="secondary" className="font-normal">
                {entry.page === null ? "No slide" : `Slide ${entry.page}`}
              </Badge>
            )}
            <LocalTime iso={entry.createdAt} variant="time" />
          </div>
          {/* Their line breaks are part of what they wrote. */}
          <p className="whitespace-pre-wrap break-words">{entry.content}</p>
        </div>

        {!entry.pending && (
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5 transition-opacity",
              // Always reachable on touch, quiet on a mouse until hovered.
              "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
            )}
          >
            {confirmingDelete ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(false)}
                >
                  <X className="size-3.5" />
                  <span className="sr-only">Keep this note</span>
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3.5" />
                  <span className="sr-only">Edit this note</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Delete this note</span>
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
