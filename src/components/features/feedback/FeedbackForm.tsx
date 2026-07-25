"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bug, Lightbulb, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setFeedbackStatus, submitFeedback } from "@/server/actions/feedback";
import type { FeedbackKind, FeedbackStatus } from "@/types/db";

const KIND_OPTIONS: Array<{
  value: FeedbackKind;
  label: string;
  hint: string;
  icon: typeof Bug;
}> = [
  { value: "bug", label: "Bug", hint: "Something's broken", icon: Bug },
  {
    value: "improvement",
    label: "Improvement",
    hint: "Make something better",
    icon: Wand2,
  },
  {
    value: "feature",
    label: "Feature idea",
    hint: "I wish ClassAct could…",
    icon: Lightbulb,
  },
];

export function FeedbackForm() {
  const router = useRouter();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!body.trim()) {
      toast.error("Tell us what happened (or what you wish happened).");
      return;
    }
    setSending(true);
    const result = await submitFeedback({ kind, body });
    setSending(false);
    if (result.ok) {
      setBody("");
      toast.success("Thanks — it's logged and the ClassAct team has been emailed.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report a bug or share an idea</CardTitle>
        <CardDescription>
          Every report lands in front of the ClassAct team — you&apos;ll see
          its status below as it moves.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {KIND_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={kind === option.value ? "default" : "outline"}
              onClick={() => setKind(option.value)}
            >
              <option.icon className="mr-1.5 size-4" />
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {KIND_OPTIONS.find((o) => o.value === kind)?.hint}
        </p>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder={
            kind === "bug"
              ? "What were you doing, what did you expect, and what happened instead?"
              : "What would make ClassAct better for you?"
          }
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button onClick={send} disabled={sending} className="w-fit">
          {sending ? "Sending…" : "Send feedback"}
        </Button>
      </CardContent>
    </Card>
  );
}

const STATUS_ORDER: FeedbackStatus[] = ["new", "planned", "done", "closed"];

/** Founder-only: click through statuses on a report. */
export function FeedbackStatusPicker({
  id,
  status,
}: {
  id: string;
  status: FeedbackStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function move(next: FeedbackStatus) {
    if (next === status) return;
    setBusy(true);
    const result = await setFeedbackStatus(id, next);
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="flex gap-1">
      {STATUS_ORDER.map((s) => (
        <Button
          key={s}
          type="button"
          size="sm"
          variant={s === status ? "default" : "ghost"}
          className="h-7 px-2 text-xs capitalize"
          disabled={busy}
          onClick={() => void move(s)}
        >
          {s}
        </Button>
      ))}
    </div>
  );
}
