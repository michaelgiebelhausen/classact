"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { giveShoutOut } from "@/server/actions/shoutouts";
import type { ShoutOutContext } from "@/types/db";

interface Props {
  courseId: string;
  classmates: Array<{ enrollmentId: string; name: string }>;
}

const CONTEXTS: Array<{ value: ShoutOutContext; label: string }> = [
  { value: "general", label: "Just because" },
  { value: "exercise", label: "Group exercise" },
  { value: "project", label: "Project work" },
];

export function ShoutOutForm({ courseId, classmates }: Props) {
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const [context, setContext] = useState<ShoutOutContext>("general");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!recipient) {
      toast.error("Pick a classmate.");
      return;
    }
    setSending(true);
    const result = await giveShoutOut({
      courseId,
      recipientEnrollmentId: recipient,
      context,
      message,
    });
    setSending(false);
    if (result.ok) {
      toast.success("Shout-out sent — they'll see it on their metrics.");
      setRecipient("");
      setMessage("");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Give a shout-out</CardTitle>
        <CardDescription>
          Saw someone do good work — in a group, on a project, anywhere?
          Call it out. It&apos;s private to them (and your professor), and
          noticing good work is a skill you get credit for.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="so-who">Who</Label>
            <select
              id="so-who"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="h-9 w-56 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="">Pick a classmate…</option>
              {classmates.map((c) => (
                <option key={c.enrollmentId} value={c.enrollmentId}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="so-context">For</Label>
            <select
              id="so-context"
              value={context}
              onChange={(e) => setContext(e.target.value as ShoutOutContext)}
              className="h-9 w-44 rounded-md border bg-transparent px-3 text-sm"
            >
              {CONTEXTS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="so-message">What they did well</Label>
          <Input
            id="so-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Carried our whole outline and made it better"
            maxLength={300}
          />
        </div>
        <Button onClick={send} disabled={sending} className="w-fit">
          {sending ? "Sending…" : "Send shout-out"}
        </Button>
      </CardContent>
    </Card>
  );
}
