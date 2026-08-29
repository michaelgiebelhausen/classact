"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GraduationCap, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { askTa } from "@/server/actions/ta";
import { capture } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export interface TaChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Props {
  courseId: string;
  initialMessages: TaChatMessage[];
  /** Non-null = chat is off; the reason renders where the input would be. */
  disabledReason: string | null;
}

/**
 * Render an answer with the TA's bracketed citations (`[Syllabus]`,
 * `[Lecture 3 slides "..."]`) as small chips. Everything else is plain
 * text — whitespace-pre-wrap does the paragraphs.
 */
function AnswerText({ content }: { content: string }) {
  const parts = content.split(/(\[[^\][\n]{1,80}\])/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\[[^\][\n]+\]$/.test(part) ? (
          <span
            key={i}
            className="mx-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            {part.slice(1, -1)}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

export function TaChat({ courseId, initialMessages, disabledReason }: Props) {
  const [messages, setMessages] = useState<TaChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, pending]);

  async function send() {
    const question = draft.trim();
    if (!question || pending) return;
    setDraft("");
    setPending(true);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: question },
    ]);
    const result = await askTa(courseId, question);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      // Put the question back so a rate-limit blip doesn't eat their typing.
      setMessages((prev) => prev.slice(0, -1));
      setDraft(question);
      return;
    }
    capture("ta_asked", {});
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}-a`,
        role: "assistant",
        content: result.data?.answer ?? "",
      },
    ]);
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
          {messages.length === 0 && !pending && (
            <div className="grid justify-items-center gap-2 py-8 text-center">
              <GraduationCap className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Ask anything about this course — deadlines, policies, what a
                lecture covered. Answers come from your course materials, with
                citations.
              </p>
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                message.role === "user"
                  ? "justify-self-end bg-primary text-primary-foreground"
                  : "justify-self-start bg-muted"
              )}
            >
              {message.role === "assistant" ? (
                <AnswerText content={message.content} />
              ) : (
                message.content
              )}
            </div>
          ))}
          {pending && (
            <div className="max-w-[85%] justify-self-start rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              Reading the course materials…
            </div>
          )}
          <div ref={endRef} />
        </div>

        {disabledReason ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            {disabledReason}
          </p>
        ) : (
          <div className="grid gap-2">
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask about the syllabus, a lecture, an assignment…"
                rows={2}
                disabled={pending}
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                onClick={() => void send()}
                disabled={pending || !draft.trim()}
                aria-label="Send question"
              >
                <SendHorizontal className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              AI answers based on your course materials — double-check anything
              important with the syllabus or your professor.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
