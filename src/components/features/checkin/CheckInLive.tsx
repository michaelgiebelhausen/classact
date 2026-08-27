"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  checkIn,
  moveSeat,
  releaseSeat,
  verifyNeighbor,
} from "@/server/actions/checkin";
import { capture } from "@/lib/analytics";
import { RoomMap } from "@/components/features/rooms/RoomMap";
import type { TableFootprint } from "@/lib/roomlayout";
import type { SeatNeighbors, SeatRelation } from "@/types/db";
import Link from "next/link";

export interface SeatInfo {
  id: string;
  label: string;
  x: number;
  y: number;
  section: string;
  tableId: string | null;
  /** Furniture drawn under a table's seats; carried from the room layout. */
  tableShape?: "rect" | "oval" | "ushape";
  /** Where the table really sits when its chairs only ring three sides. */
  tableFootprint?: TableFootprint;
  neighbors: SeatNeighbors;
}

export interface OccupantInfo {
  enrollmentId: string;
  seatId: string;
  verified: boolean;
}

export interface DirectoryEntry {
  name: string;
  photoUrl: string | null;
}

interface Props {
  courseId: string;
  sessionId: string | null;
  seats: SeatInfo[];
  initialOccupants: OccupantInfo[];
  directory: Record<string, DirectoryEntry>;
  myEnrollmentId: string | null;
  networkingScore: number;
  verifiedByMe: string[]; // subject enrollment ids I already confirmed today
  /** "Class meets Mon, Wed, Fri · 9:30 AM…" — shown while check-in is closed. */
  scheduleHint?: string | null;
  /** Seat ids I've checked into before (any session) — powers the new-seat nudge. */
  mySeatIds?: string[];
  /** Distinct classmates I've verified with, either direction. */
  peopleMet?: number;
  /** Professor view: tap a student, then tap a seat, to reassign them. */
  canReassign?: boolean;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function CheckInLive({
  courseId,
  sessionId,
  seats,
  initialOccupants,
  directory,
  myEnrollmentId,
  networkingScore,
  verifiedByMe,
  scheduleHint,
  mySeatIds = [],
  peopleMet = 0,
  canReassign = false,
}: Props) {
  const router = useRouter();
  const [occupants, setOccupants] = useState<Map<string, OccupantInfo>>(
    () => new Map(initialOccupants.map((o) => [o.seatId, o]))
  );
  const [pendingSeat, setPendingSeat] = useState<string | null>(null);
  const [score, setScore] = useState(networkingScore);
  const [confirmed, setConfirmed] = useState<Set<string>>(
    () => new Set(verifiedByMe)
  );
  const [live, setLive] = useState(true);
  /**
   * Students can turn the map around.
   *
   * At least one wrong-seat check-in happened because the map was read the
   * wrong way up. Which way round is "obvious" depends on where you're sitting
   * and which way you're facing, so rather than pick one and insist, let them
   * match the map to the room in front of them.
   */
  const [studentFlipped, setStudentFlipped] = useState(false);
  const unknownEnrollment = useRef(false);

  const seatByLabel = useMemo(() => {
    const m = new Map<string, SeatInfo>();
    for (const s of seats) m.set(s.label, s);
    return m;
  }, [seats]);

  const mySeatSet = useMemo(() => new Set(mySeatIds), [mySeatIds]);

  const myCheckIn = useMemo(
    () =>
      myEnrollmentId
        ? Array.from(occupants.values()).find(
            (o) => o.enrollmentId === myEnrollmentId
          ) ?? null
        : null,
    [occupants, myEnrollmentId]
  );
  const mySeat = myCheckIn
    ? seats.find((s) => s.id === myCheckIn.seatId) ?? null
    : null;

  const applyChange = useCallback((row: OccupantInfo) => {
    setOccupants((prev) => {
      const next = new Map(prev);
      next.set(row.seatId, row);
      return next;
    });
  }, []);

  // Waiting room: with a schedule set, re-check every 30s so the map
  // appears on its own the moment auto-open fires — no manual reload.
  useEffect(() => {
    if (sessionId || !scheduleHint) return;
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [sessionId, scheduleHint, router]);

  // Realtime subscription with 5s polling fallback (FR-010).
  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    // When this client dropped off realtime, so the report on the way back up
    // can say how long it spent hammering the fallback.
    let degradedSince: number | null = null;

    // Fire-and-forget: a failed report must never disturb check-in, and must
    // never retry — a retry loop during an outage is more of the problem.
    const report = (
      state: "down" | "up",
      extra: { degradedMs?: number; reason?: string }
    ) => {
      void fetch("/api/metrics/realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, state, ...extra }),
        keepalive: true,
      }).catch(() => {});
    };

    const channel = supabase
      .channel(`session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "check_ins",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const rec = payload.new as {
            enrollment_id: string;
            seat_id: string;
            verified: boolean;
          };
          if (!rec?.seat_id) return;
          applyChange({
            enrollmentId: rec.enrollment_id,
            seatId: rec.seat_id,
            verified: rec.verified,
          });
          // Someone we don't have in the directory (activated after load).
          if (!directory[rec.enrollment_id] && !unknownEnrollment.current) {
            unknownEnrollment.current = true;
            router.refresh();
          }
        }
      )
      .subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        setLive(ok);
        if (!ok && !pollTimer) {
          // The fallback is the prime suspect for the room freezing. Every
          // client that loses realtime starts refreshing the WHOLE page —
          // about eleven queries — and forty phones dropping together at
          // 9:29 then hammer in lockstep, against the same database realtime
          // is already struggling with.
          //
          // Jittered and slowed until the instrumentation says otherwise:
          // 6–12s instead of a synchronised 5s roughly halves the sustained
          // rate and, more importantly, spreads it out instead of arriving
          // as one spike per interval. The cost is a map up to twelve
          // seconds stale while realtime is down, which is the state where
          // it is already degraded.
          const period = 6000 + Math.floor(Math.random() * 6000);
          pollTimer = setInterval(() => router.refresh(), period);
          degradedSince = Date.now();
          report("down", { reason: status });
        }
        if (ok && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
          report("up", {
            degradedMs: degradedSince ? Date.now() - degradedSince : 0,
          });
          degradedSince = null;
        }
      });

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [sessionId, applyChange, directory, router]);

  /**
   * Tap an open seat: check in, or — if already checked in — move there.
   *
   * The move case is why a mis-tap used to displace two people. There was no
   * way to leave a seat, so the student who took the wrong one stayed put and
   * its rightful occupant had to go elsewhere.
   */
  /**
   * Professor: tap an occupied seat to empty it.
   *
   * Deliberately not a reassignment. Moving a student somewhere else means
   * deciding what happens to whoever is already there, which needs a swap and
   * an atomicity story. Freeing the seat needs neither: the student checks
   * themselves back in wherever they actually are.
   */
  async function handleProfessorTap(seat: { id: string; label: string }) {
    if (!sessionId || pendingSeat) return;
    const occupant = occupants.get(seat.id);
    if (!occupant) return;

    const previous = occupants;
    const who = directory[occupant.enrollmentId]?.name ?? "That student";

    setPendingSeat(seat.id);
    setOccupants((prev) => {
      const next = new Map(prev);
      next.delete(seat.id);
      return next;
    });

    const result = await releaseSeat(sessionId, seat.id);
    setPendingSeat(null);

    if (result.ok) {
      toast.success(
        `Seat ${seat.label} is free. ${who} can check in again wherever they are.`,
        { duration: 6000 }
      );
    } else {
      setOccupants(previous);
      toast.error(result.error, { duration: 8000 });
    }
  }

  async function handleSeatTap(seat: { id: string; label: string }) {
    if (canReassign) return handleProfessorTap(seat);
    if (!sessionId || !myEnrollmentId || pendingSeat) return;
    if (occupants.has(seat.id)) return;

    const from = myCheckIn?.seatId ?? null;
    const previous = occupants;

    setPendingSeat(seat.id);
    // Optimistic: vacate the old seat and fill the new one in one step, so the
    // map never shows the same person twice. Verification rides along —
    // correcting a seat must not look like it cost them anything.
    setOccupants((prev) => {
      const next = new Map(prev);
      if (from) next.delete(from);
      next.set(seat.id, {
        enrollmentId: myEnrollmentId,
        seatId: seat.id,
        verified: myCheckIn?.verified ?? false,
      });
      return next;
    });

    const result = from
      ? await moveSeat(sessionId, seat.id)
      : await checkIn(sessionId, seat.id);
    setPendingSeat(null);

    if (result.ok && result.data) {
      if (from) {
        toast.success(`Moved to seat ${seat.label}. Your attendance is safe.`);
      } else {
        capture("checkin_completed", { isNewSeat: result.data.isNewSeat });
        toast.success(
          result.data.isNewSeat
            ? `You're checked in, seat ${seat.label}. +1 networking point — new seat.`
            : `You're checked in, seat ${seat.label}.`
        );
      }
      // The move can flip whether the seat they ended on was new to them, in
      // either direction, so take the server's word rather than incrementing.
      if (from) router.refresh();
      else if (result.data.isNewSeat) setScore((s) => s + 1);
    } else {
      setOccupants(previous); // whole-map rollback: a move touches two seats
      toast.error(result.ok ? "That didn't work." : result.error);
      if (!result.ok && result.code === "already_checked_in") router.refresh();
    }
  }

  async function handleVerify(subjectEnrollmentId: string, relation: SeatRelation) {
    if (!sessionId) return;
    const result = await verifyNeighbor(sessionId, subjectEnrollmentId, relation);
    if (result.ok) {
      capture("neighbor_verified", { relation });
      setConfirmed((prev) => new Set(prev).add(subjectEnrollmentId));
      toast.success("Confirmed. You've officially met.");
    } else {
      toast.error(result.error);
    }
  }

  // Students get a waiting room; the professor gets the room itself. They are
  // usually looking at this page — often projecting it — before anyone can
  // check in, and an empty seat map filling up is the point. A paragraph of
  // text where the map goes is the thing this replaces.
  if (!sessionId && !canReassign) {
    return (
      <Card>
        <CardContent className="grid gap-2 py-12 text-center text-muted-foreground">
          <p>
            Class hasn&apos;t started yet.{" "}
            {scheduleHint
              ? "The seat map opens automatically at class time."
              : "The seat map opens when your professor starts today's session."}
          </p>
          {scheduleHint && <p className="text-sm">{scheduleHint}</p>}
        </CardContent>
      </Card>
    );
  }

  if (seats.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          This room doesn&apos;t have a seat map yet — your professor sets that
          up before the first check-in.
        </CardContent>
      </Card>
    );
  }

  // Neighbor prompts: adjacent, checked-in, not yet confirmed by me.
  const neighborPrompts: {
    relation: SeatRelation;
    seat: SeatInfo;
    occupant: OccupantInfo;
    entry: DirectoryEntry | undefined;
  }[] = [];
  if (mySeat) {
    (["front", "back", "left", "right"] as SeatRelation[]).forEach((relation) => {
      const neighborLabel = mySeat.neighbors?.[relation];
      const seat = neighborLabel ? seatByLabel.get(neighborLabel) : undefined;
      if (!seat) return;
      const occupant = occupants.get(seat.id);
      if (!occupant || occupant.enrollmentId === myEnrollmentId) return;
      if (confirmed.has(occupant.enrollmentId)) return;
      neighborPrompts.push({
        relation,
        seat,
        occupant,
        entry: directory[occupant.enrollmentId],
      });
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {mySeat ? (
            <Badge>
              Your seat: {mySeat.label}
              {myCheckIn?.verified ? " · verified" : " · awaiting a neighbor"}
            </Badge>
          ) : (
            <Badge variant="secondary">Tap an open seat to check in</Badge>
          )}
          <Badge variant="outline">Networking score: {score}</Badge>
        </div>
        {!live && (
          <Badge variant="secondary" className="animate-pulse">
            Reconnecting — updates every 5s
          </Badge>
        )}
      </div>

      {!myCheckIn && myEnrollmentId && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">Sit somewhere new today.</span> A seat
          you haven&apos;t tried (marked with a dot) is +1 to your networking
          score, and confirming a neighbor you haven&apos;t met before grows
          your people-met count — both feed your work-readiness metrics.
          So far you&apos;ve tried{" "}
          <span className="font-medium">
            {mySeatSet.size} {mySeatSet.size === 1 ? "seat" : "seats"}
          </span>{" "}
          and met{" "}
          <span className="font-medium">
            {peopleMet} {peopleMet === 1 ? "classmate" : "classmates"}
          </span>
          .
        </p>
      )}

      {canReassign && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            You&apos;re looking at the room from the front.
          </span>{" "}
          {sessionId ? (
            <>
              Someone in a seat they&apos;re not sitting in? Tap them to free it
              — they can check in again wherever they actually are.
            </>
          ) : (
            <>
              Check-in hasn&apos;t opened yet, so the room is empty.
              {scheduleHint ? ` ${scheduleHint}` : ""}
            </>
          )}
        </p>
      )}

      {!canReassign && seats.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>
            The <span className="font-medium text-foreground">front of the room</span>{" "}
            is at the {studentFlipped ? "bottom" : "top"} of this map.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setStudentFlipped((v) => !v)}
          >
            Turn the map around
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border p-4">
        <RoomMap
          seats={seats}
          onSeatTap={handleSeatTap}
          captions={canReassign}
          flipped={canReassign || studentFlipped}
          perspective={canReassign}
          fit={canReassign}
          podium
          frontLabel={
            canReassign
              ? "You are here — front of room"
              : studentFlipped
                ? "Front of room (behind you)"
                : "Front of room"
          }
          stateFor={(seat) => {
            const occupant = occupants.get(seat.id);
            const isMine = occupant?.enrollmentId === myEnrollmentId;
            const entry = occupant ? directory[occupant.enrollmentId] : undefined;
            return {
              kind: isMine
                ? "mine"
                : occupant
                  ? occupant.verified
                    ? "verified"
                    : "taken"
                  : "empty",
              name: entry?.name ?? (occupant ? "A classmate" : null),
              photoUrl: entry?.photoUrl ?? null,
              pending: pendingSeat === seat.id,
              // The professor taps an occupied seat to free it, so an empty
              // one does nothing. Students tap open seats — a check-in first,
              // a move afterwards.
              tappable: canReassign
                ? Boolean(occupant) && pendingSeat === null
                : !occupant && pendingSeat === null && Boolean(myEnrollmentId),
              caption: canReassign
                ? entry?.name?.split(/\s+/)[0] ?? undefined
                : undefined,
              highlight: canReassign
                ? false
                : !occupant &&
                  !myCheckIn &&
                  Boolean(myEnrollmentId) &&
                  !mySeatSet.has(seat.id),
            };
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border bg-card" /> Open
          </span>
          {!myCheckIn && myEnrollmentId && (
            <span className="flex items-center gap-1.5">
              <span className="relative inline-block h-3 w-3 rounded-sm border border-primary/40 bg-card">
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary/70" />
              </span>{" "}
              New to you (+1)
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-muted-foreground/20" /> Taken
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-primary" /> You
          </span>
        </div>
      </div>

      {mySeat && neighborPrompts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirm your neighbors</CardTitle>
            <CardDescription>
              Verify the people around you are actually here — and say hi
              while you&apos;re at it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {neighborPrompts.map(({ relation, seat, occupant, entry }) => (
              <div
                key={occupant.enrollmentId}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    {entry?.photoUrl && (
                      <AvatarImage src={entry.photoUrl} alt={entry?.name ?? ""} />
                    )}
                    <AvatarFallback>
                      {initials(entry?.name ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">
                      {entry?.name ?? "A classmate"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {relation === "front"
                        ? "In front of you"
                        : relation === "back"
                          ? "Behind you"
                          : relation === "left"
                            ? "To your left"
                            : "To your right"}{" "}
                      · seat {seat.label}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleVerify(occupant.enrollmentId, relation)}
                >
                  They&apos;re here
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {mySeat && (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={`/course/${courseId}/games`}>
              Play a name game while you wait
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
