"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  sendSetPasswordLinks,
  resetStuckAccount,
  approveJoiners,
  resolveDuplicate,
} from "@/server/actions/activation";
import type { RosterStage } from "@/lib/rosterstage";
import type { StagedPerson } from "@/components/features/roster/StagedRoster";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * One roster section: the faces, and the one fix that section needs.
 *
 * Faces stay even in the sections that are really worklists. A professor
 * recognises the student standing in front of them by their face long before
 * they parse `sswande@g.clemson.edu`, and these are the sections most likely
 * to be worked with a queue at the desk.
 *
 * Every button says what it does to whom rather than naming a mechanism —
 * "Email them the join code", not "Reinvite" — because the sections exist to
 * spare the professor from having to know which internal state each student
 * is in.
 */
export function RosterSection({
  stage,
  courseId,
  joinCode,
  people,
}: {
  stage: RosterStage;
  courseId: string;
  joinCode: string | null;
  people: StagedPerson[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const ids = people.map((p) => p.id);

  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    try {
      await work();
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const emailPasswords = () =>
    run("bulk", async () => {
      const result = await sendSetPasswordLinks({
        courseId,
        enrollmentIds: ids,
      });
      if (!result.ok) return toast.error(result.error, { duration: 10_000 });
      const { sent, failed } = result.data ?? { sent: 0, failed: 0 };
      toast.success(
        failed > 0
          ? `Sent ${sent}. ${failed} had no account to recover.`
          : `Sent ${sent} set-password link${sent === 1 ? "" : "s"}.`
      );
      router.refresh();
    });

  const emailJoinCode = () =>
    run("bulk", async () => {
      // The invite email already renders the join code and link from the
      // course's own template, so this reuses the path the roster invite uses
      // rather than inventing a second kind of invitation.
      const res = await fetch("/api/invites/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, enrollmentIds: ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        return toast.error(body?.error ?? "Couldn't send those.", {
          duration: 10_000,
        });
      }
      const body = await res.json().catch(() => null);
      toast.success(
        `Sent the join code to ${body?.sent ?? ids.length} student${
          (body?.sent ?? ids.length) === 1 ? "" : "s"
        }.`
      );
      router.refresh();
    });

  const approveOne = (person: StagedPerson) =>
    run(person.id, async () => {
      const result = await approveJoiners({
        courseId,
        enrollmentIds: [person.id],
      });
      if (!result.ok) return toast.error(result.error, { duration: 8000 });
      toast.success(`${person.name} can check in now.`);
      router.refresh();
    });

  const resolveOne = (person: StagedPerson) =>
    run(person.id, async () => {
      const result = await resolveDuplicate({
        courseId,
        enrollmentId: person.id,
      });
      if (!result.ok) return toast.error(result.error, { duration: 12_000 });
      toast.success(
        result.data?.accountDeleted
          ? `Removed the duplicate ${result.data.removed} and its unused login. Their real row is untouched.`
          : `Removed the duplicate ${result.data?.removed}. Their real row is untouched.`,
        { duration: 8000 }
      );
      router.refresh();
    });

  const resetOne = (person: StagedPerson) =>
    run(person.id, async () => {
      const result = await resetStuckAccount({
        courseId,
        enrollmentId: person.id,
      });
      if (!result.ok) return toast.error(result.error, { duration: 10_000 });
      toast.success(
        `Cleared. ${person.name} can sign up now with ${result.data?.email ?? "their email"} and the join code.`,
        { duration: 10_000 }
      );
      router.refresh();
    });

  return (
    <div className="grid gap-3">
      {stage === "needs_password" && joinCode && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          With the student in front of you, <span className="font-medium text-foreground">Reset</span>{" "}
          is fastest — then they sign up at{" "}
          <span className="font-mono font-medium text-foreground">
            classact.college/join/{joinCode}
          </span>{" "}
          with any password and they&apos;re in immediately. Emailing a link is
          the calmer choice outside class; it&apos;s a round trip through their
          inbox.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {stage === "needs_password" && (
          <Button size="sm" onClick={emailPasswords} disabled={busy !== null}>
            {busy === "bulk"
              ? "Sending…"
              : `Email them a set-password link (${people.length})`}
          </Button>
        )}
        {stage === "needs_class" && (
          <Button size="sm" onClick={emailJoinCode} disabled={busy !== null}>
            {busy === "bulk"
              ? "Sending…"
              : `Email them the join code (${people.length})`}
          </Button>
        )}
        {stage === "invite_failed" && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/course/${courseId}/setup`}>
              Fix their address in Setup
            </Link>
          </Button>
        )}
        {stage === "awaiting_approval" && people.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              run("bulk", async () => {
                const result = await approveJoiners({
                  courseId,
                  enrollmentIds: ids,
                });
                if (!result.ok)
                  return toast.error(result.error, { duration: 8000 });
                toast.success(
                  `Approved ${result.data?.approved ?? ids.length}. They can check in now.`
                );
                router.refresh();
              })
            }
            disabled={busy !== null}
          >
            {busy === "bulk" ? "Approving…" : `Approve all ${people.length}`}
          </Button>
        )}
        {stage === "duplicate" && (
          <span className="text-xs text-muted-foreground">
            Removing a duplicate deletes this spare row and the unused login
            behind it. Their real row — name, photo, attendance — is untouched,
            and any row holding check-ins is refused rather than removed.
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 sm:grid-cols-5 md:grid-cols-6">
        {people.map((p) => (
          <div key={p.id} className="flex flex-col items-center gap-1 text-center">
            <Avatar className="h-14 w-14">
              {p.photoUrl && <AvatarImage src={p.photoUrl} alt={p.name} />}
              <AvatarFallback>{initials(p.name)}</AvatarFallback>
            </Avatar>
            <span className="text-xs leading-tight">{p.name}</span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              {p.email}
            </span>
            {p.note && (
              <span className="text-[10px] leading-tight text-muted-foreground/80">
                {p.note}
              </span>
            )}

            {stage === "awaiting_approval" && (
              <Button
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={busy !== null}
                onClick={() => approveOne(p)}
              >
                {busy === p.id ? "Approving…" : "Approve"}
              </Button>
            )}

            {stage === "duplicate" &&
              (confirming === p.id ? (
                <span className="flex flex-col items-center gap-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 px-2 text-[10px]"
                    disabled={busy !== null}
                    onClick={() => resolveOne(p)}
                  >
                    {busy === p.id ? "Removing…" : "Yes, remove"}
                  </Button>
                  <button
                    type="button"
                    className="text-[10px] underline text-muted-foreground"
                    onClick={() => setConfirming(null)}
                  >
                    cancel
                  </button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={busy !== null}
                  onClick={() => setConfirming(p.id)}
                >
                  Remove duplicate
                </Button>
              ))}

            {stage === "needs_password" &&
              (confirming === p.id ? (
                <span className="flex flex-col items-center gap-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 px-2 text-[10px]"
                    disabled={busy !== null}
                    onClick={() => resetOne(p)}
                  >
                    {busy === p.id ? "Clearing…" : "Yes, reset"}
                  </Button>
                  <button
                    type="button"
                    className="text-[10px] underline text-muted-foreground"
                    onClick={() => setConfirming(null)}
                  >
                    cancel
                  </button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={busy !== null}
                  onClick={() => setConfirming(p.id)}
                >
                  Reset
                </Button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
