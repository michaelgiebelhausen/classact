"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  sendSetPasswordLinks,
  resetStuckAccount,
} from "@/server/actions/activation";
import type { StagedPerson } from "@/components/features/roster/StagedRoster";

/**
 * The stuck section, built for the front of a classroom rather than a desk.
 *
 * A grid of faces is the wrong shape here: at 9:29 the professor has a queue
 * of students and needs a name, an address, what's actually wrong, and one
 * button — per person, readable at arm's length.
 *
 * Two problems live in this section and their remedies are opposites:
 *
 * - **needs a password** — confirmed their email, never got a session. In the
 *   room, Reset is the fast fix: it clears the dead account so they register
 *   again on the spot. Emailing a link works too, but it is a round trip
 *   through their inbox while everyone waits.
 * - **needs an invite** — already has a working account, just isn't enrolled
 *   here. Reset would destroy something real and fix nothing; they need the
 *   join code, which is why it's printed at the top.
 */
export function StuckList({
  courseId,
  joinCode,
  people,
}: {
  courseId: string;
  joinCode: string | null;
  people: StagedPerson[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const needPassword = people.filter((p) => p.remedy === "set_password");
  const needInvite = people.filter((p) => p.remedy === "reinvite");

  async function emailAll() {
    setBusy("bulk");
    const result = await sendSetPasswordLinks({
      courseId,
      enrollmentIds: needPassword.map((p) => p.id),
    });
    setBusy(null);
    if (!result.ok) return toast.error(result.error, { duration: 10_000 });
    const { sent, failed } = result.data ?? { sent: 0, failed: 0 };
    toast.success(
      failed > 0
        ? `Sent ${sent}. ${failed} had no account to recover.`
        : `Sent ${sent} set-password link${sent === 1 ? "" : "s"}.`
    );
    router.refresh();
  }

  async function reset(person: StagedPerson) {
    setBusy(person.id);
    const result = await resetStuckAccount({
      courseId,
      enrollmentId: person.id,
    });
    setBusy(null);
    setConfirming(null);
    if (!result.ok) return toast.error(result.error, { duration: 10_000 });
    toast.success(
      `Cleared. ${person.name} can sign up now with ${result.data?.email ?? "their email"} and the join code.`,
      { duration: 10_000 }
    );
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {joinCode && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Fastest fix with the student in front of you: press{" "}
            <span className="font-medium text-foreground">Reset</span>, then
            have them sign up at
          </span>{" "}
          <span className="font-mono font-medium">
            classact.college/join/{joinCode}
          </span>
          <span className="text-muted-foreground">
            {" "}
            with any password. They&apos;re in immediately — no email involved.
          </span>
        </div>
      )}

      <div className="grid gap-1.5">
        {people.map((p) => {
          const resettable = p.remedy === "set_password";
          return (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.email}</span>
              <Badge variant={resettable ? "destructive" : "secondary"}>
                {p.note ?? "stuck"}
              </Badge>
              <span className="ml-auto flex items-center gap-2">
                {resettable ? (
                  confirming === p.id ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        Clear their account?
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy !== null}
                        onClick={() => reset(p)}
                      >
                        {busy === p.id ? "Clearing…" : "Yes, reset"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => setConfirming(p.id)}
                    >
                      Reset
                    </Button>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Give them the join code — their account already works.
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {needPassword.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={emailAll}
            disabled={busy !== null}
          >
            {busy === "bulk"
              ? "Sending…"
              : `Email set-password links (${needPassword.length})`}
          </Button>
        )}
        {needInvite.length > 0 && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/course/${courseId}/setup`}>
              Invite the {needInvite.length} who need it
            </Link>
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          Emailing is the calmer option outside class — it&apos;s a round trip
          through their inbox.
        </span>
      </div>
    </div>
  );
}
