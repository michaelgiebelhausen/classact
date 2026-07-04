"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { sendLoginLink } from "@/server/actions/auth";

function LoginForm() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const result = await sendLoginLink({ email });
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
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {status === "sent"
            ? "Check your email — your sign-in link is on the way."
            : "We'll email you a sign-in link. No password to remember."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {urlError === "expired" && status === "idle" && (
          <p className="mb-3 text-sm text-destructive">
            That link expired — request a new one.
          </p>
        )}
        {status === "sent" ? (
          <p className="text-sm text-muted-foreground">
            Sent to <span className="font-medium">{email}</span>. You can close
            this tab once you&apos;ve clicked the link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
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
              {status === "sending" ? "Sending…" : "Email me a sign-in link"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Student with a join code?{" "}
              <Link href="/join" className="underline underline-offset-4">
                Join your class
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
