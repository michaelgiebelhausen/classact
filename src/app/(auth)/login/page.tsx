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
import { CALLBACK_MESSAGES, reasonFromQuery } from "@/lib/authreason";

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
  // `reason` is the current vocabulary; `error` is what older emails still
  // carry. reasonFromQuery translates the legacy values rather than dropping
  // them, which is how the old `?error=missing` came to render nothing.
  const callbackReason = reasonFromQuery(
    searchParams.get("reason"),
    searchParams.get("error")
  );
  // Set when a link died mid-join: keep the student headed for their class.
  const nextAfterAuth = searchParams.get("next") ?? "/dashboard";
  const [mode, setMode] = useState<Mode>("password");
  const [role, setRole] = useState<"professor" | "student">("professor");
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
        router.push(nextAfterAuth);
        router.refresh();
      } else {
        toast.error(result.error);
      }
      return;
    }
    if (mode === "signup") {
      const result = await signUpWithPassword({ email, password, role });
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
        router.push(role === "professor" ? "/course/new" : "/dashboard");
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
        {callbackReason && !sent && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive">
              {CALLBACK_MESSAGES[callbackReason].headline}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {CALLBACK_MESSAGES[callbackReason].help}
            </p>
          </div>
        )}
        {sent ? (
          <p className="text-sm text-muted-foreground">
            Sent to <span className="font-medium">{email}</span>.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            {mode === "signup" && (
              <div className="grid gap-2">
                <Label>I&apos;m signing up as…</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={role === "professor" ? "default" : "outline"}
                    onClick={() => setRole("professor")}
                  >
                    A professor
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={role === "student" ? "default" : "outline"}
                    onClick={() => setRole("student")}
                  >
                    A student
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {role === "professor"
                    ? "You'll create your class right after confirming your email."
                    : "Students usually join with a code from their professor."}
                </p>
              </div>
            )}
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
