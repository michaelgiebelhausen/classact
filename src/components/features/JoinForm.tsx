"use client";

import { useState } from "react";
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
import { sendJoinLink } from "@/server/actions/auth";

export function JoinForm({
  initialCode,
  badCode,
}: {
  initialCode?: string;
  badCode?: boolean;
}) {
  const [code, setCode] = useState(initialCode ?? "");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const result = await sendJoinLink({ code, email });
    if (result.ok) {
      setStatus("sent");
    } else {
      setStatus("idle");
      toast.error(result.error);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Join your class</CardTitle>
        <CardDescription>
          {status === "sent"
            ? "Check your email — your join link is on the way."
            : "Enter the code from your professor and your school email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {badCode && status === "idle" && (
          <p className="mb-3 text-sm text-destructive">
            That join code didn&apos;t match a class — double-check it with
            your professor.
          </p>
        )}
        {status === "sent" ? (
          <p className="text-sm text-muted-foreground">
            Sent to <span className="font-medium">{email}</span>. Click the
            link to finish joining.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="code">Join code</Label>
              <Input
                id="code"
                required
                placeholder="MKT-7Q2X"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono tracking-widest"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">School email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@university.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Email me a join link"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
