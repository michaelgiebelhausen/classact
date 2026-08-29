"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookCheck, CircleDashed, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { indexNextMaterial } from "@/server/actions/ta";
import { capture } from "@/lib/analytics";

export interface IndexItem {
  label: string;
  indexed: boolean;
}

interface Props {
  courseId: string;
  items: IndexItem[];
  /** False when the course has no AI key — indexing can't run either. */
  enabled: boolean;
}

/**
 * Professor-only: the TA's reading list, and the crank that turns PDFs into
 * corpus text. One item per server-action call, looped from the client
 * while the page is open — the same idiom as the grading analysis runner.
 * Transcripts and text syllabi index themselves at upload; only PDFs wait.
 */
export function TaIndexPanel({ courseId, items, enabled }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const pendingCount = items.filter((i) => !i.indexed).length;

  async function runIndexing() {
    setRunning(true);
    try {
      for (;;) {
        const result = await indexNextMaterial(courseId);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        const { remaining, indexed } = result.data ?? {
          remaining: 0,
          indexed: null,
        };
        if (indexed) {
          setProgress(
            remaining > 0
              ? `Indexed ${indexed} — ${remaining} to go…`
              : `Indexed ${indexed}.`
          );
        }
        if (remaining === 0) {
          capture("ta_indexed", {});
          toast.success("The TA has read everything.");
          return;
        }
      }
    } finally {
      setRunning(false);
      setProgress(null);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">What the TA can read</CardTitle>
            <CardDescription>
              Slides and PDF readings need a one-time indexing pass (runs on
              your AI key). Transcripts and text syllabi are read instantly.
            </CardDescription>
          </div>
          {pendingCount > 0 && (
            <Button
              size="sm"
              onClick={() => void runIndexing()}
              disabled={running || !enabled}
            >
              {running ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Indexing…
                </>
              ) : (
                `Index ${pendingCount} ${pendingCount === 1 ? "item" : "items"}`
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet — upload slides, transcripts, or a syllabus and they
            show up here.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {items.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-2 text-sm"
              >
                {item.indexed ? (
                  <BookCheck className="size-4 shrink-0 text-[var(--flame,#e0552f)]" />
                ) : (
                  <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className={item.indexed ? "" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        )}
        {progress && (
          <p className="mt-3 text-xs text-muted-foreground">{progress}</p>
        )}
      </CardContent>
    </Card>
  );
}
