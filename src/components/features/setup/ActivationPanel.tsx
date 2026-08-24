"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ACTIONABLE_STATES,
  ACTIVATION_META,
  summarize,
  type ActivationState,
} from "@/lib/activation";
import {
  sendSetPasswordLinks,
  type ActivationRow,
} from "@/server/actions/activation";

/**
 * Who is actually in the class, and what would move each student forward.
 *
 * This replaced a two-state table ("Emailed" / "Activated") that couldn't tell
 * the difference between a student who never received an email and one holding
 * a confirmed account they can't sign into. Those two need opposite remedies,
 * and the second group is invisible from the enrollments table alone — it takes
 * auth data, which is why the rows arrive from a server action rather than the
 * page's own query.
 */
export function ActivationPanel({
  courseId,
  rows,
  onReinvite,
  reinviting,
}: {
  courseId: string;
  /** Classified on the server — see getActivationRoster. */
  rows: ActivationRow[];
  /** Reuses the Invite tab's sender so the professor's edited copy is used. */
  onReinvite: (enrollmentIds: string[]) => Promise<void>;
  reinviting: boolean;
}) {
  const router = useRouter();
  const [busyState, setBusyState] = useState<ActivationState | null>(null);

  async function rescue(ids: string[]) {
    setBusyState("stuck_no_session");
    const result = await sendSetPasswordLinks({ courseId, enrollmentIds: ids });
    setBusyState(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const { sent = 0, failed = 0 } = result.data ?? {};
    if (sent > 0) toast.success(`Sent ${sent} set-password link(s).`);
    if (failed > 0) toast.error(`${failed} couldn't be sent.`);
    router.refresh();
  }

  async function reinvite(state: ActivationState, ids: string[]) {
    setBusyState(state);
    await onReinvite(ids);
    setBusyState(null);
  }

  const counts = summarize(rows.map((r) => r.state));
  const active = counts.active;
  const needsAttention = ACTIONABLE_STATES.filter((s) => counts[s] > 0);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Who&apos;s in the class</Label>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {active} of {rows.length}
          </span>{" "}
          {rows.length === 1 ? "student is" : "students are"} signed in and
          enrolled.
          {needsAttention.length === 0 && rows.length > 0
            ? " Nobody is stuck."
            : ""}
        </p>
      </div>

      {needsAttention.map((state) => {
        const meta = ACTIVATION_META[state];
        const group = rows.filter((r) => r.state === state);
        const ids = group.map((r) => r.enrollmentId);
        const busy = busyState === state || (reinviting && busyState === state);

        return (
          <div key={state} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant={meta.tone}>{meta.label}</Badge>
                <span className="text-sm font-medium">{group.length}</span>
              </div>

              {meta.remedy === "set_password" && (
                <Button size="sm" disabled={busy} onClick={() => rescue(ids)}>
                  {busy ? "Sending…" : `Send set-password link (${group.length})`}
                </Button>
              )}
              {meta.remedy === "reinvite" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => reinvite(state, ids)}
                >
                  {busy ? "Sending…" : `Re-invite (${group.length})`}
                </Button>
              )}
            </div>

            <p className="mt-2 text-sm text-muted-foreground">{meta.blurb}</p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Last invite</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.map((r) => (
                  <TableRow key={r.enrollmentId}>
                    <TableCell>
                      <div>{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.inviteError ? (
                        <span className="text-xs text-destructive">
                          {r.inviteError}
                        </span>
                      ) : r.invitedAt ? (
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.invitedAt).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Never
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}
