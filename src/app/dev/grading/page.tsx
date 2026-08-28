import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { isConfigured } from "@/lib/env";
import { listDryRuns } from "@/server/actions/gradingdev";
import { GradingBench } from "@/components/features/assignments/GradingBench";

/**
 * The grading bench — founder only.
 *
 * Two halves, deliberately separate. The mock list is free: it exercises the
 * dragging, banding and score preview against fake rows, which is where the
 * interaction bugs live. The dry run is not free: it seeds a throwaway
 * assignment and lets the real pipeline grade it with real API calls, which
 * is the only way to learn what a live model actually returns.
 *
 * Gated where /dev/roommap is not, because that page renders shapes and this
 * one spends money and writes rows.
 */
export default async function GradingDevPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.founder || !isConfigured.supabaseAdmin) redirect("/feedback");

  const listing = await listDryRuns();

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Grading bench</h1>
        <p className="text-sm text-muted-foreground">
          Founder-only. The mock list below is free. A dry run seeds a
          throwaway assignment and grades it with real API calls — roughly 15
          model calls, well under a dollar, on whichever key the course
          resolves to.
        </p>
      </div>

      <GradingBench
        courses={listing.ok && listing.data ? listing.data.courses : []}
        runs={listing.ok && listing.data ? listing.data.runs : []}
      />
    </div>
  );
}
