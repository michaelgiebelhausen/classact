import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { reasonFromAuthError, type CallbackReason } from "@/lib/authreason";

/** Only allow same-app relative redirects. */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  return next;
}

const EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

function asOtpType(value: string | null): EmailOtpType | null {
  return (EMAIL_OTP_TYPES as readonly string[]).includes(value ?? "")
    ? (value as EmailOtpType)
    : null;
}

function fail(reason: CallbackReason, next: string) {
  const url = new URL("/login", env.siteUrl);
  url.searchParams.set("reason", reason);
  // Keep the destination so a student who signs in by password still lands on
  // the class they were joining rather than a bare dashboard.
  if (next !== "/dashboard") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

/**
 * Answer HEAD without touching the token.
 *
 * University mail security fetches every link in an email before the person
 * does. Next.js answers a HEAD by running the GET handler, so those probes
 * were calling `verifyOtp` — which CONSUMES the one-time token — and the
 * student's real click, arriving about a second later, found an expired link.
 *
 * The production logs are unambiguous: nearly every student GET of this route
 * is preceded by a HEAD one second earlier, each returning 307 because the GET
 * handler ran. Some HEADs have no GET behind them at all: a link burned by a
 * scanner for a student who never even clicked.
 *
 * This is what survived the PKCE fix, the token_hash templates, and turning
 * off email confirmation. Every one of those changed WHICH link we send; none
 * of them changed who opens it first.
 */
export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 200 });
}

/**
 * Finish an email auth link.
 *
 * Two shapes arrive here, and only one of them survives leaving the device:
 *
 * - `?token_hash=…&type=…` — verified with `verifyOtp`, which reads no local
 *   storage at all. Works from any browser, any device, a fresh incognito
 *   window. This is what the Supabase email templates should send.
 * - `?code=…` — the PKCE exchange, which needs the `code_verifier` cookie held
 *   by the browser that *started* the flow. Fine same-browser, structurally
 *   impossible cross-device.
 *
 * `token_hash` is tried first so that once the email templates are switched
 * over (HANDOFF.md), the cross-device path is the one that runs. `code` stays
 * supported because links already sitting in students' inboxes still use it.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));

  // Supabase reports its own failures by redirecting here with error params
  // rather than a token. Surfacing them beats showing a blank sign-in form.
  const providerError = params.get("error") ?? params.get("error_code");
  const tokenHash = params.get("token_hash");
  const code = params.get("code");

  if (providerError && !tokenHash && !code) {
    const expired =
      providerError === "otp_expired" || providerError === "access_denied";
    return fail(expired ? "link_expired" : "provider_error", next);
  }

  const supabase = await createClient();

  if (tokenHash) {
    const type = asOtpType(params.get("type"));
    if (!type) return fail("link_invalid", next);

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) return fail(reasonFromAuthError(error), next);

    return NextResponse.redirect(new URL(next, env.siteUrl));
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail(reasonFromAuthError(error), next);

    return NextResponse.redirect(new URL(next, env.siteUrl));
  }

  return fail("no_token", next);
}
