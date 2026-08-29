"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Mail, NotebookPen } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LocalTime } from "@/components/ui/localtime";
import {
  NoteEntryItem,
  type NoteEntryData,
} from "@/components/features/notes/NoteEntryItem";
import { emailNotesExport } from "@/server/actions/notes";
import {
  buildNotesMarkdown,
  notesFilename,
  type ExportLecture,
} from "@/lib/notesmd";

export interface ArchiveLecture {
  lectureId: string;
  /** ISO timestamp. */
  startedAt: string;
  deckTitle: string;
  /** Signed download URL for the lecture's slide PDF, when there is one. */
  slidesUrl?: string | null;
  /** Transcript title shows even when downloads are toggled off… */
  transcriptTitle?: string | null;
  /** …but the URL is only minted while the professor allows downloads. */
  transcriptUrl?: string | null;
  entries: NoteEntryData[];
}

interface Props {
  courseId: string;
  courseName: string;
  viewerEmail: string;
  lectures: ArchiveLecture[];
}

/** The viewer's zone, so an export reads in the times they experienced. */
function localZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function toExportLectures(lectures: ArchiveLecture[]): ExportLecture[] {
  return lectures.map((l) => ({
    startedAt: l.startedAt,
    deckTitle: l.deckTitle,
    entries: l.entries.map((e) => ({
      page: e.page,
      content: e.content,
      createdAt: e.createdAt,
    })),
  }));
}

export function NotesArchive({
  courseId,
  courseName,
  viewerEmail,
  lectures: initialLectures,
}: Props) {
  const [lectures, setLectures] = useState(initialLectures);
  const [emailTarget, setEmailTarget] = useState<ArchiveLecture | "all" | null>(
    null
  );
  const [recipient, setRecipient] = useState(viewerEmail);
  const [sending, setSending] = useState(false);

  const totalEntries = useMemo(
    () => lectures.reduce((sum, l) => sum + l.entries.length, 0),
    [lectures]
  );

  function download(scope: ArchiveLecture | "all") {
    const picked = scope === "all" ? lectures : [scope];
    const markdown = buildNotesMarkdown({
      courseName,
      exportedAt: new Date().toISOString(),
      timeZone: localZone(),
      lectures: toExportLectures(picked),
    });
    const filename = notesFilename(
      courseName,
      scope === "all" ? undefined : scope.startedAt.slice(0, 10)
    );

    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function sendEmail() {
    if (!emailTarget) return;
    setSending(true);
    const result = await emailNotesExport({
      courseId,
      lectureId: emailTarget === "all" ? undefined : emailTarget.lectureId,
      to: recipient,
      timeZone: localZone(),
    });
    setSending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Sent to ${recipient}.`);
    setEmailTarget(null);
  }

  function updateEntry(lectureId: string, id: string, content: string) {
    setLectures((prev) =>
      prev.map((l) =>
        l.lectureId === lectureId
          ? {
              ...l,
              entries: l.entries.map((e) =>
                e.id === id ? { ...e, content } : e
              ),
            }
          : l
      )
    );
  }

  function removeEntry(lectureId: string, id: string) {
    setLectures((prev) =>
      prev
        .map((l) =>
          l.lectureId === lectureId
            ? { ...l, entries: l.entries.filter((e) => e.id !== id) }
            : l
        )
        .filter((l) => l.entries.length > 0)
    );
  }

  if (totalEntries === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NotebookPen className="size-4" /> No notes yet
          </CardTitle>
          <CardDescription>
            Notes you take during Follow Along are saved here automatically,
            stamped with the slide you were on. You&apos;ll be able to download
            them as a Markdown file or email them anywhere — including to
            yourself or an AI assistant.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Your notes are saved here</CardTitle>
              <CardDescription>
                {totalEntries} {totalEntries === 1 ? "note" : "notes"} across{" "}
                {lectures.length}{" "}
                {lectures.length === 1 ? "lecture" : "lectures"}. Only you can
                read them. Take them with you whenever you like.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => download("all")}>
                <Download className="size-4" /> Download all
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRecipient(viewerEmail);
                  setEmailTarget("all");
                }}
              >
                <Mail className="size-4" /> Email all
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {lectures.map((lecture) => (
        <Card key={lecture.lectureId}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {lecture.deckTitle || "Lecture"}
                </CardTitle>
                <CardDescription>
                  <LocalTime iso={lecture.startedAt} variant="short" /> ·{" "}
                  {lecture.entries.length}{" "}
                  {lecture.entries.length === 1 ? "note" : "notes"}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {lecture.slidesUrl && (
                  <Button asChild variant="ghost" size="sm">
                    <a href={lecture.slidesUrl}>
                      <Download className="size-4" /> Slides
                    </a>
                  </Button>
                )}
                {lecture.transcriptUrl && (
                  <Button asChild variant="ghost" size="sm">
                    <a href={lecture.transcriptUrl}>
                      <Download className="size-4" /> Transcript
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => download(lecture)}
                >
                  <Download className="size-4" /> Notes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRecipient(viewerEmail);
                    setEmailTarget(lecture);
                  }}
                >
                  <Mail className="size-4" /> Email
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {lecture.entries.map((entry) => (
                <NoteEntryItem
                  key={entry.id}
                  courseId={courseId}
                  entry={entry}
                  onUpdated={(id, content) =>
                    updateEntry(lecture.lectureId, id, content)
                  }
                  onDeleted={(id) => removeEntry(lecture.lectureId, id)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      <Dialog
        open={emailTarget !== null}
        onOpenChange={(open) => {
          if (!open && !sending) setEmailTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email your notes</DialogTitle>
            <DialogDescription>
              {emailTarget === "all"
                ? `All ${totalEntries} of your notes for ${courseName}, as a Markdown file.`
                : `Your notes from ${emailTarget?.deckTitle || "this lecture"}, as a Markdown file.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="notes-email-to">Send to</Label>
            <Input
              id="notes-email-to"
              type="email"
              value={recipient}
              disabled={sending}
              onChange={(e) => setRecipient(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendEmail();
                }
              }}
              placeholder="you@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Any address — your own inbox, or an assistant that reads Markdown.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={sending}
              onClick={() => setEmailTarget(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void sendEmail()}
              disabled={sending || !recipient.trim()}
            >
              {sending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
