import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Minimal Stripe client (no SDK): checkout + billing-portal sessions via
 * the REST API, and webhook signature verification per Stripe's t/v1
 * scheme. $5/mo professor subscriptions — card on file, self-serve cancel.
 */

const STRIPE_API = "https://api.stripe.com/v1";

function form(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

async function stripePost<T>(
  path: string,
  data: Record<string, string>
): Promise<T | null> {
  if (!env.stripeSecretKey) return null;
  try {
    const response = await fetch(`${STRIPE_API}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${env.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form(data),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`[stripe] ${path} → ${response.status}: ${detail.slice(0, 300)}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (e) {
    console.error(`[stripe] ${path} failed:`, e);
    return null;
  }
}

/** Subscription checkout for a professor; returns the redirect URL. */
export async function createCheckoutSession(input: {
  profileId: string;
  email: string | undefined;
}): Promise<string | null> {
  if (!env.stripePriceId) return null;
  const session = await stripePost<{ url?: string }>("/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": env.stripePriceId,
    "line_items[0][quantity]": "1",
    client_reference_id: input.profileId,
    ...(input.email ? { customer_email: input.email } : {}),
    success_url: `${env.siteUrl}/dashboard?billing=success`,
    cancel_url: `${env.siteUrl}/dashboard?billing=cancelled`,
  });
  return session?.url ?? null;
}

/** Self-serve manage/cancel portal for an existing customer. */
export async function createPortalSession(
  customerId: string
): Promise<string | null> {
  const session = await stripePost<{ url?: string }>("/billing_portal/sessions", {
    customer: customerId,
    return_url: `${env.siteUrl}/dashboard`,
  });
  return session?.url ?? null;
}

/**
 * Verify a webhook payload against the Stripe-Signature header
 * (t=timestamp,v1=hmac). Returns the parsed event or null.
 */
export function verifyWebhook(
  payload: string,
  signatureHeader: string | null
): { type: string; data: { object: Record<string, unknown> } } | null {
  const secret = env.stripeWebhookSecret;
  if (!secret || !signatureHeader) return null;
  const parts = new Map(
    signatureHeader.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)] as const;
    })
  );
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return null;
  // Tolerate 10 minutes of clock skew / retry delay.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 600) return null;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(payload) as {
      type: string;
      data: { object: Record<string, unknown> };
    };
  } catch {
    return null;
  }
}
