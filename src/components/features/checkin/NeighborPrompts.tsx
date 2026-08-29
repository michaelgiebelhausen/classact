"use client";

/**
 * The neighbor card, upgraded from a single "confirm" list into the check-in
 * feature's social surface.
 *
 * Three regimes, decided per row and per minute:
 *
 *  - FIRST MEETING, social mode: the full introduction treatment — bigger
 *    photo, an icebreaker fact to open with, and an explicit "introduce
 *    yourself" ask. This only ever happens for a pair who have never
 *    confirmed each other in any session, so the ask stays special.
 *  - REPEAT NEIGHBORS: collapsed into one quiet tap ("Still your row:
 *    Alex, Priya?"), because re-asking for a ceremony with someone you sat
 *    next to all term is how prompts get ignored — and ignored prompts
 *    starve the professor's rings of data.
 *  - QUIET MODE (from the scheduled start, sharp): all social framing
 *    drops away and what remains is the silent confirm — a latecomer's
 *    neighbors confirm them without anyone being told to say hello
 *    mid-lecture.
 *
 * The card no longer vanishes when there's nothing to do: the early arriver
 * gets told the nudge will find them ("even if you're off playing a name
 * game" — the course-wide arrival toast makes that true), which is also the
 * explanation of their amber ring.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { stablePhotoUrl } from "@/lib/photopin";
import { initialsOf } from "@/lib/names";
import { isSocialMode } from "@/lib/arrivals";
import { denySentence, relationPhrase } from "@/lib/seatrings";
import type { SeatRelation } from "@/types/db";

export interface NeighborPromptRow {
  relation: SeatRelation;
  seatLabel: string;
  enrollmentId: string;
  /** Full class-visible name — only for the avatar's initials. */
  name: string | null;
  /** What you'd actually call them when you turn around and say hello. */
  firstName: string | null;
  photoUrl: string | null;
  /** These two have never confirmed each other, in any session. */
  firstEver: boolean;
  /** One icebreaker fact, when they answered any — an opener, not a dossier. */
  fact: { label: string; value: string } | null;
}

interface Props {
  rows: NeighborPromptRow[];
  /** ISO instant when social mode ends; null = quiet the whole session. */
  socialEndsAt: string | null;
  /** I'm checked in and nobody else is in the room yet. */
  aloneInRoom: boolean;
  onVerify: (enrollmentId: string, relation: SeatRelation) => Promise<boolean>;
  onDeny: (enrollmentId: string, relation: SeatRelation) => Promise<boolean>;
}

/** The given name to address someone by, or a pronoun when we have none. */
function callThem(row: { firstName: string | null }): string {
  return row.firstName?.trim() || "They";
}

export function NeighborPrompts({
  rows,
  socialEndsAt,
  aloneInRoom,
  onVerify,
  onDeny,
}: Props) {
  // The boundary is one-way and time-based, so a single re-render at the
  // minute it passes is all the state this needs. The countdown line ticks
  // at 30s only while it's actually on screen.
  const endsAt = useMemo(
    () => (socialEndsAt ? new Date(socialEndsAt) : null),
    [socialEndsAt]
  );
  const [now, setNow] = useState(() => new Date());
  const social = isSocialMode(endsAt, now);
  useEffect(() => {
    if (!endsAt) return;
    const remaining = endsAt.getTime() - Date.now();
    if (remaining <= 0) return;
    // Beyond an hour out there is nothing to count down to on this card;
    // one timer to the boundary itself still flips the mode.
    const tick = remaining <= 60 * 60 * 1000 ? 30_000 : remaining;
    const timer = setInterval(() => setNow(new Date()), Math.min(tick, remaining));
    return () => clearInterval(timer);
  }, [endsAt, social]);
  const minutesToStart =
    social && endsAt
      ? Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / 60_000))
      : null;

  // "Someone's not there?" reveals the deny step for one row at a time —
  // discoverable when something is wrong, invisible ceremony when not.
  const [denyOpenFor, setDenyOpenFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const intros = rows.filter((r) => r.firstEver);
  const repeats = rows.filter((r) => !r.firstEver);
  const [repeatsExpanded, setRepeatsExpanded] = useState(false);

  async function verify(row: NeighborPromptRow) {
    setBusy(row.enrollmentId);
    await onVerify(row.enrollmentId, row.relation);
    setBusy(null);
  }

  async function confirmAll() {
    setBusy("__all__");
    for (const row of repeats) {
      // Sequential on purpose: each is its own server action POST, and a
      // burst of four from one phone gains nothing but contention.
      await onVerify(row.enrollmentId, row.relation);
    }
    setBusy(null);
  }

  async function deny(row: NeighborPromptRow) {
    setBusy(row.enrollmentId);
    const ok = await onDeny(row.enrollmentId, row.relation);
    setBusy(null);
    if (ok) {
      setDenyOpenFor(null);
      toast.success("Noted. Their seat is flagged for your professor.");
    }
  }

  const denyAffordance = (row: NeighborPromptRow) =>
    denyOpenFor === row.enrollmentId ? (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {denySentence(callThem(row), row.relation)}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={busy !== null}
          onClick={() => deny(row)}
        >
          Report it
        </Button>
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setDenyOpenFor(null)}
        >
          Never mind
        </button>
      </div>
    ) : (
      <button
        type="button"
        className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => setDenyOpenFor(row.enrollmentId)}
      >
        Someone&apos;s not there?
      </button>
    );

  const title =
    rows.length === 0
      ? aloneInRoom
        ? "You're first"
        : "Neighbors confirmed"
      : social && intros.length > 0
        ? "Meet your neighbors"
        : "Confirm your neighbors";
  const description =
    rows.length === 0
      ? aloneInRoom
        ? "No one's around you yet. When someone sits down next to you, we'll nudge you — even if you're off playing a name game."
        : "Everyone around you is confirmed."
      : social
        ? `Say hi before class starts — confirming a neighbor counts attendance for you both.${
            minutesToStart !== null && minutesToStart <= 60
              ? ` Class starts in ${minutesToStart} min.`
              : ""
          }`
        : "Quietly confirm who's around you — it marks you both present.";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.length === 0 && !aloneInRoom && (
          <p className="text-xs text-muted-foreground">
            New arrivals next to you will show up here.
          </p>
        )}

        {intros.map((row) => (
          <div
            key={row.enrollmentId}
            className="grid gap-2 rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  {row.photoUrl && (
                    <AvatarImage
                      src={stablePhotoUrl(row.photoUrl) ?? row.photoUrl}
                      alt={row.firstName ?? ""}
                    />
                  )}
                  <AvatarFallback>{initialsOf(row.name ?? "?")}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">
                    {row.firstName ?? "A classmate"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {relationPhrase(row.relation, "theirs")
                      .replace(/^./, (c) => c.toUpperCase())}{" "}
                    · seat {row.seatLabel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.fact ? (
                      <>
                        <span className="font-medium text-foreground/80">
                          {row.fact.label}:
                        </span>{" "}
                        {row.fact.value}
                      </>
                    ) : (
                      <>You two haven&apos;t met yet.</>
                    )}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => verify(row)}
              >
                They&apos;re here
              </Button>
            </div>
            {social && (
              <p className="text-xs text-muted-foreground">
                Introduce yourself — then confirm they&apos;re here.
              </p>
            )}
            {denyAffordance(row)}
          </div>
        ))}

        {repeats.length > 0 &&
          (repeatsExpanded || repeats.length === 1 ? (
            repeats.map((row) => (
              <div
                key={row.enrollmentId}
                className="grid gap-2 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm">
                    Still next to{" "}
                    <span className="font-medium">
                      {row.firstName ?? "your neighbor"}
                    </span>
                    ?{" "}
                    <span className="text-xs text-muted-foreground">
                      ({relationPhrase(row.relation, "theirs")} · seat{" "}
                      {row.seatLabel})
                    </span>
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => verify(row)}
                  >
                    Confirm
                  </Button>
                </div>
                {denyAffordance(row)}
              </div>
            ))
          ) : (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  Still your row:{" "}
                  <span className="font-medium">
                    {repeats.map((r) => callThem(r)).join(", ")}
                  </span>
                  ?
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={confirmAll}
                >
                  Confirm all {repeats.length}
                </Button>
              </div>
              <button
                type="button"
                className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setRepeatsExpanded(true)}
              >
                Someone&apos;s not there?
              </button>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
