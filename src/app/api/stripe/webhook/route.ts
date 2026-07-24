import { NextResponse } from "next/server";
import { verifyWebhook } from "@/server/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";

/**
 * Stripe → profiles.subscription_status sync. Signature-verified; unknown
 * events are acknowledged and ignored. Local dev: `stripe listen --forward-to
 * localhost:3000/api/stripe/webhook` (see HANDOFF.md).
 */

export async function POST(request: Request) {
  const payload = await request.text();
  const event = verifyWebhook(payload, request.headers.get("stripe-signature"));
  if (!event) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  if (!isConfigured.supabaseAdmin) {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  const admin = createAdminClient();
  const object = event.data.object;

  if (event.type === "checkout.session.completed") {
    const profileId = object.client_reference_id as string | null;
    const customerId = object.customer as string | null;
    if (profileId && customerId) {
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId, subscription_status: "active" })
        .eq("id", profileId);
    }
  } else if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const customerId = object.customer as string | null;
    const status =
      event.type === "customer.subscription.deleted"
        ? "canceled"
        : ((object.status as string | undefined) ?? "active");
    if (customerId) {
      await admin
        .from("profiles")
        .update({ subscription_status: status })
        .eq("stripe_customer_id", customerId);
    }
  }

  return NextResponse.json({ received: true });
}
