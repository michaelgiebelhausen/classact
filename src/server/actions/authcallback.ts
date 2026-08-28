"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { reasonFromAuthError } from "@/lib/authreason";
import { asOtpType, failPath, safeNext } from "@/lib/authcallback";

/**
 * Spend the one-time token and sign the person in.
 *
 * Deliberately a POST, reached only by someone pressing the button on
 * /auth/callback. University mail security fetches every link in an email
 * before its recipient does, and a token verified by that fetch is gone by the
 * time the student clicks — which is what "that link has expired" meant all
 * week. Scanners follow links; they do not submit forms.
 *
 * Redirects to relative paths rather than absolute URLs, so this works on
 * whatever host the app is served from.
 */
export async function completeAuthCallback(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next") as string | null);
  const tokenHash = (formData.get("token_hash") as string) || null;
  const code = (formData.get("code") as string) || null;

  const supabase = await createClient();

  if (tokenHash) {
    const type = asOtpType(formData.get("type") as string | null);
    if (!type) redirect(failPath("link_invalid", next));

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) redirect(failPath(reasonFromAuthError(error), next));
    redirect(next);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) redirect(failPath(reasonFromAuthError(error), next));
    redirect(next);
  }

  redirect(failPath("no_token", next));
}
