"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendSetPasswordLinks } from "@/server/actions/activation";
import type { StagedPerson } from "@/components/features/roster/StagedRoster";

/**
 * Remedies for the stuck section — one button per problem, not one for the lot.
 *
 * "Stuck" holds two situations whose fixes are opposites, and the difference is
 * invisible from a grid of faces:
 *
 * - **Needs a password.** Confirmed their email, never obtained a session,
 *   because their sign-up link only worked in the browser that requested it.
 *   A set-password link fixes them; another invite cannot, because the invite
 *   is not what failed.
 * - **Needs an invite.** Already has a working account and has signed in —
 *   they simply aren't enrolled in *this* class, usually a join link they
 *   never opened. A password link would sign them in and change nothing.
 *
 * Sending the wrong one is not harmless: it looks like help, the student
 * follows it, nothing improves, and they stop believing the next email.
 */
export function StuckActions({
  courseId,
  people,
}: {
  courseId: string;
  people: StagedPerson[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const needPassword = people.filter((p) => p.remedy === "set_password");
  const needInvite = people.filter((p) => p.remedy === "reinvite");

  async function send() {
    setBusy(true);
    const result = await sendSetPasswordLinks({
      courseId,
      enrollmentIds: needPassword.map((p) => p.id),
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error, { duration: 10_000 });
      return;
    }
    const { sent, failed } = result.data ?? { sent: 0, failed: 0 };
    toast.success(
      failed > 0
        ? `Sent ${sent}. ${failed} had no account to recover — they need an invite instead.`
        : `Sent ${sent} set-password link${sent === 1 ? "" : "s"}.`
    );
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      {needPassword.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={send} disabled={busy}>
            {busy
              ? "Sending…"
              : `Email set-password links (${needPassword.length})`}
          </Button>
          <span className="text-xs text-muted-foreground">
            For the {needPassword.length} marked{" "}
            <span className="font-medium">needs a password</span> — works on any
            device, unlike the sign-up link that stranded them.
          </span>
        </div>
      )}

      {needInvite.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/course/${courseId}/setup`}>
              Invite the other {needInvite.length}
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            The ones marked <span className="font-medium">needs an invite</span>{" "}
            can already sign in — they just aren&apos;t in this class yet. A
            password link wouldn&apos;t help them.
          </span>
        </div>
      )}
    </div>
  );
}
