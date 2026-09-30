"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { advanceAnalysis, retryUnreadable } from "@/server/actions/grading";

/**
 * What the grader is still doing after the ranking lands: late submissions
 * being scored (they join the list on their own), and any file the AI gave up
 * on — which the professor grades by hand, because it isn't in the list.
 */
export function GradingQueueNotice({
  assignmentId,
  pending,
  unreadable,
}: {
  assignmentId: string;
  /** Late submissions still in the grader. */
  pending: number;
  unreadable: Array<{ name: string; reason: string }>;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const lastScored = useRef<number | null>(null);

  // The tick grades these on its own; nudging from here just lands them
  // sooner while the professor is watching. Refresh as each one arrives.
  useEffect(() => {
    if (pending === 0) return;
    let cancelled = false;
    async function nudge() {
      while (!cancelled) {
        const result = await advanceAnalysis(assignmentId).catch(() => null);
        if (cancelled) break;
        if (result?.ok && result.data && result.data.total >= 0) {
          if (lastScored.current !== null && result.data.scored > lastScored.current) {
            router.refresh();
          }
          lastScored.current = result.data.scored;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    void nudge();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, pending, router]);

  if (pending === 0 && unreadable.length === 0) return null;

  async function retry() {
    setRetrying(true);
    const result = await retryUnreadable(assignmentId);
    setRetrying(false);
    if (result.ok) {
      toast.success("Queued again — the grader will retry them in the next minute.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card className="border-primary/50">
      <CardContent className="grid gap-3 py-5">
        {pending > 0 && (
          <p className="text-sm">
            <span className="font-medium">
              {pending} late submission{pending === 1 ? " is" : "s are"} being
              graded
            </span>{" "}
            <span className="text-muted-foreground">
              — {pending === 1 ? "it joins" : "they join"} the list on{" "}
              {pending === 1 ? "its" : "their"} own, usually within a minute or
              two. Publishing waits until {pending === 1 ? "it's" : "they're"} in.
            </span>
          </p>
        )}
        {unreadable.length > 0 && (
          <div className="grid gap-2">
            <p className="text-sm">
              <span className="font-medium">
                The AI couldn&apos;t grade {unreadable.length} submission
                {unreadable.length === 1 ? "" : "s"}
              </span>{" "}
              <span className="text-muted-foreground">
                — {unreadable.length === 1 ? "it isn't" : "they aren't"} in the
                list below, so grade {unreadable.length === 1 ? "it" : "them"} by
                hand.
              </span>
            </p>
            <ul className="grid gap-1 text-sm">
              {unreadable.map((u, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{u.name}</span>
                  <span className="text-muted-foreground">{u.reason}</span>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void retry()}
              disabled={retrying}
            >
              {retrying ? "Queuing…" : "Try these again"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
