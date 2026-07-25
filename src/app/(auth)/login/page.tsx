"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
  requestPasswordReset,
  sendLoginLink,
  signInWithPassword,
  signUpWithPassword,
} from "@/server/actions/auth";

/**
 * Password-first sign-in (magic links stay as the fallback for accounts
 * that predate passwords). Modes: password / signup / forgot / magic.
 */

type Mode = "password" | "signup" | "forgot" | "magic";

const HEADINGS: Record<Mode, { title: string; blurb: string }> = {
  password: { title: "Sign in", blurb: "Welcome back — email and password." },
  signup: {
    title: "Create your account",
    blurb: "One confirmation email, then it's just email + password.",
  },
  forgot: {
    title: "Reset your password",
    blurb: "We'll email you a link to set a new one.",
  },
  magic: {
    title: "Sign in by email",
    blurb: "We'll email you a one-time sign-in link.",
  },
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // confirmation blurb

  function switchMode(next: Mode) {
    setMode(next);
    setSent(null);
    setPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "password") {
      const result = await signInWithPassword({ email, password });
      setBusy(false);
      if (result.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        toast.error(result.error);
      }
      return;
    }
    if (mode === "signup") {
      const result = await signUpWithPassword({ email, password });
      setBusy(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data?.confirmationNeeded) {
        setSent(
          "Almost there — click the confirmation link we just emailed you, and you'll land signed in."
        );
      } else {
        router.push("/dashboard");
        router.refresh();
      }
      return;
    }
    if (mode === "forgot") {
      const result = await requestPasswordReset({ email });
      setBusy(false);
      if (result.ok) {
        setSent(
          "If that email has an account, a password-reset link is on the way."
        );
      } else {
        toast.error(result.error);
      }
      return;
    }
    const result = await sendLoginLink({ email });
    setBusy(false);
    if (result.ok) {
      setSent("Check your email — your sign-in link is on the way.");
    } else {
      toast.error(result.error);
    }
  }

  const showPassword = mode === "password" || mode === "signup";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{HEADINGS[mode].title}</CardTitle>
        <CardDescription>{sent ?? HEADINGS[mode].blurb}</CardDescription>
      </CardHeader>
      <CardContent>
        {urlError === "expired" && !sent && (
          <p className="mb-3 text-sm text-destructive">
            That link expired — request a new one.
          </p>
        )}
        {sent ? (
          <p className="text-sm text-muted-foreground">
            Sent to <span className="font-medium">{email}</span>.
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
            {showPassword && (
              <div className="grid gap-2">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "password" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === "signup" && (
                  <p className="text-xs text-muted-foreground">
                    At least 8 characters.
                  </p>
                )}
              </div>
            )}
            <Button type="submit" disabled={busy}>
              {busy
                ? "Working…"
                : mode === "password"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Email me a reset link"
                      : "Email me a sign-in link"}
            </Button>

            <div className="grid gap-1.5 text-center text-sm text-muted-foreground">
              {mode === "password" ? (
                <>
                  <p>
                    New here?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("signup")}
                      className="underline underline-offset-4"
                    >
                      Create an account
                    </button>
                  </p>
                  <p>
                    <button
                      type="button"
                      onClick={() => switchMode("magic")}
                      className="underline underline-offset-4"
                    >
                      Email me a sign-in link instead
                    </button>
                  </p>
                </>
              ) : (
                <p>
                  <button
                    type="button"
                    onClick={() => switchMode("password")}
                    className="underline underline-offset-4"
                  >
                    Back to sign in
                  </button>
                </p>
              )}
              <p>
                Student with a join code?{" "}
                <Link href="/join" className="underline underline-offset-4">
                  Join your class
                </Link>
              </p>
            </div>
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
