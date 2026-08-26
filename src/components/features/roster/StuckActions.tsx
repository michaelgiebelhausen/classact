"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendSetPasswordLinks } from "@/server/actions/activation";
import type { StagedPerson } from "@/components/features/roster/StagedRoster";

/**
 * One button for the whole stuck section.
 *
 * These students confirmed their email and never obtained a session — their
 * sign-up link only worked in the browser that requested it, and theirs
 * didn't. Another invite cannot help: the invite is not what failed. A
 * set-password link can, because it is verified server-side and opens on any
 * device.
 *
 * Deliberately not "delete their account and let the next sync rebuild them".
 * That would work — enrollments survive a profile deletion with profile_id
 * nulled, so attendance is safe — but it also throws away their uploaded
 * photo and their identity to solve a problem a link solves, and it cannot be
 * undone if the professor clicks it on the wrong person.
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

  async function send() {
    setBusy(true);
    const result = await sendSetPasswordLinks({
      courseId,
      enrollmentIds: people.map((p) => p.id),
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
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={send} disabled={busy || people.length === 0}>
        {busy ? "Sending…" : `Email set-password links (${people.length})`}
      </Button>
      <span className="text-xs text-muted-foreground">
        Works on any device — unlike the sign-up link that stranded them.
      </span>
    </div>
  );
}
