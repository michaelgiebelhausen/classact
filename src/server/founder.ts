import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Whether the signed-in user is a founder account.
 *
 * Gates the tools that destroy things rather than merely re-arranging a
 * roster: deleting a student's login, removing an enrolment row, merging two
 * identities. Those exist because the developer is currently also the
 * professor, running an intense trial on his own classes, and needed to fix
 * live data by hand.
 *
 * They are not things an ordinary professor should be able to do. A professor
 * manages a roster — drop someone, block someone, invite someone — and every
 * one of those is reversible. Deleting an account is not, and nobody should
 * hold that power over a student because they happen to teach them.
 *
 * Kept rather than deleted so the trial keeps its velocity; the decision to
 * remove them outright belongs to a moment when the developer is not also the
 * only user.
 */
export async function isFounder(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("founder")
    .eq("id", user.id)
    .maybeSingle();

  return Boolean(profile?.founder);
}

/** Shared refusal, so all three tools decline identically. */
export const FOUNDER_ONLY =
  "That tool isn't available. Professors can drop or block a student, but accounts themselves are managed by ClassAct support.";
