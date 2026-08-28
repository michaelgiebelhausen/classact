import type { EmailOtpType } from "@supabase/supabase-js";
import type { CallbackReason } from "@/lib/authreason";

/**
 * The rules the email-link callback runs on, in one place.
 *
 * The page that shows the "Sign me in" button and the action that spends the
 * token both need them, and they must not drift: `safeNext` is what stops a
 * token-bearing URL being used as an open redirect, and a copy of it that
 * quietly falls behind is a security bug rather than a tidiness one.
 */

/** Only ever redirect somewhere inside this app. */
export function safeNext(next: string | null | undefined): string {
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

export function asOtpType(value: string | null | undefined): EmailOtpType | null {
  return (EMAIL_OTP_TYPES as readonly string[]).includes(value ?? "")
    ? (value as EmailOtpType)
    : null;
}

/**
 * Where a failed link sends someone. Carries the destination along so a
 * student who signs in by password still lands on the class they were joining
 * rather than a bare dashboard.
 */
export function failPath(reason: CallbackReason, next: string): string {
  const qs = new URLSearchParams({ reason });
  if (next !== "/dashboard") qs.set("next", next);
  return `/login?${qs.toString()}`;
}

/** A `?error=…` from Supabase itself, mapped to something a student reads. */
export function reasonFromProviderError(code: string): CallbackReason {
  return code === "otp_expired" || code === "access_denied"
    ? "link_expired"
    : "provider_error";
}

/** First value only — a repeated query parameter arrives as an array. */
export function one(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
