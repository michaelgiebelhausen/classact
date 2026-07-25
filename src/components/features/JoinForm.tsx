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
import { sendJoinLink, signUpAndJoin } from "@/server/actions/auth";

/**
 * Password-first join: code + email + password creates the account (one
 * confirmation email finishes the join), and an existing account with the
 * right password joins instantly. The email-link flow stays as a fallback.
 */
export function JoinForm({
  initialCode,
  badCode,
}: {
  initialCode?: string;
  badCode?: boolean;
}) {
  const [code, setCode] = useState(initialCode ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magic, setMagic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (magic) {
      const result = await sendJoinLink({ code, email });
      setBusy(false);
      if (result.ok) {
        setSent("Check your email — your join link is on the way.");
      } else {
        toast.error(result.error);
      }
      return;
    }
    const result = await signUpAndJoin({ code, email, password });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.data?.mode === "signed_in") {
      // The join route activates the enrollment and forwards to onboarding.
      window.location.assign(`/auth/join?code=${encodeURIComponent(code)}`);
    } else {
      setSent(
        "One more step — click the confirmation link we just emailed you and you'll land in your class."
      );
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Join your class</CardTitle>
        <CardDescription>
          {sent ??
            "Enter the code from your professor, your school email, and a password for your new account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {badCode && !sent && (
          <p className="mb-3 text-sm text-destructive">
            That join code didn&apos;t match a class — double-check it with
            your professor.
          </p>
        )}
        {sent ? (
          <p className="text-sm text-muted-foreground">
            Sent to <span className="font-medium">{email}</span>.
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
            {!magic && (
              <div className="grid gap-2">
                <Label htmlFor="join-password">Password</Label>
                <Input
                  id="join-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters. Already have an account? Same form —
                  just use your existing password.
                </p>
              </div>
            )}
            <Button type="submit" disabled={busy}>
              {busy
                ? "Working…"
                : magic
                  ? "Email me a join link"
                  : "Join class"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => {
                  setMagic((m) => !m);
                  setSent(null);
                }}
                className="underline underline-offset-4"
              >
                {magic ? "Use a password instead" : "Email me a join link instead"}
              </button>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
