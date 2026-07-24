"use server";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { createCheckoutSession, createPortalSession } from "@/server/stripe";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Billing ($5/mo professor subscription). The gate lives in createCourse;
 * these actions hand the browser Stripe URLs. Students are never billed.
 */

/** May this profile create courses right now? */
export async function billingGate(profile: {
  founder: boolean;
  comp: boolean;
  subscription_status: string | null;
}): Promise<{ allowed: boolean }> {
  if (!env.billingEnabled) return { allowed: true };
  return {
    allowed:
      profile.founder || profile.comp || profile.subscription_status === "active",
  };
}

/** Start the $5/mo subscription checkout; returns the redirect URL. */
export async function startCheckout(): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const url = await createCheckoutSession({
    profileId: user.id,
    email: user.email,
  });
  if (!url) {
    return {
      ok: false,
      error: "Billing isn't configured on this server — contact support.",
    };
  }
  return { ok: true, data: { url } };
}

/** Open the Stripe customer portal (manage card / cancel). */
export async function openBillingPortal(): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();
  if (!profile?.stripe_customer_id) {
    return { ok: false, error: "No billing account yet — subscribe first." };
  }
  const url = await createPortalSession(profile.stripe_customer_id);
  if (!url) return { ok: false, error: "Couldn't open the billing portal." };
  return { ok: true, data: { url } };
}
