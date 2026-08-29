"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  checkIn,
  denyNeighbor,
  moveSeat,
  professorConfirmAttendance,
  releaseSeat,
  verifyNeighbor,
} from "@/server/actions/checkin";
import { capture } from "@/lib/analytics";
import { RoomMap } from "@/components/features/rooms/RoomMap";
import { NeighborPrompts, type NeighborPromptRow } from "@/components/features/checkin/NeighborPrompts";
import { SeatActionCard } from "@/components/features/checkin/SeatActionCard";
import { deriveSeatRing, type SeatRing } from "@/lib/seatrings";
import { stablePhotoUrl } from "@/lib/photopin";
import type { TableFootprint } from "@/lib/roomlayout";
import type { SeatNeighbors, SeatRelation } from "@/types/db";
import Link from "next/link";
import { Dices } from "lucide-react";

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
  /** check_ins row id — DELETE realtime payloads carry only this. */
  id: string;
  enrollmentId: string;
  seatId: string;
  verified: boolean;
  /** Active "not in that seat" reports against this check-in. */
  deniedCount: number;
  /** The professor vouched from the map. */
  professorConfirmed: boolean;
}

export interface DirectoryEntry {
  name: string;
  /** Given name — what a seat label or a spoken prompt calls someone. */
  firstName: string;
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
  /** Enrollment ids I've EVER confirmed with — repeat neighbors skip the intro. */
  metBeforeIds?: string[];
  /** One icebreaker fact per classmate, for the introduction rows. */
  neighborFacts?: Record<string, { label: string; value: string }>;
  /** ISO instant when "introduce yourself" turns into silent confirm-only. */
  socialEndsAt?: string | null;
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
  metBeforeIds = [],
  neighborFacts = {},
  socialEndsAt = null,
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
  // Neighbors I reported this session: their prompt row leaves the card, and
  // it stays gone even if nothing about their check-in changes.
  const [deniedByMe, setDeniedByMe] = useState<Set<string>>(() => new Set());
  const metBefore = useMemo(() => new Set(metBeforeIds), [metBeforeIds]);
  const [live, setLive] = useState(true);
  /** Professor: the tapped seat whose action card is open in a dialog. */
  const [actionSeatId, setActionSeatId] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  /**
   * Students can turn the map around.
   *
   * At least one wrong-seat check-in happened because the map was read the
   * wrong way up. Which way round is "obvious" depends on where you're sitting
   * and which way you're facing, so rather than pick one and insist, let them
   * match the map to the room in front of them.
   */
  const [studentFlipped, setStudentFlipped] = useState(false);
  /**
   * Cold call: the last random pick, keyed by student (not seat) so the ring
   * follows a reassignment and vanishes if they leave. The session id rides
   * along so a pick never outlives the class it was made in.
   */
  const [spotlight, setSpotlight] = useState<{
    sessionId: string;
    enrollmentId: string;
  } | null>(null);
  const spotlightId =
    spotlight && spotlight.sessionId === sessionId
      ? spotlight.enrollmentId
      : null;
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
      // A move arrives as an UPDATE keyed by the NEW seat; without evicting
      // the old entry the same student renders in two seats on everyone
      // else's map until a full refresh.
      for (const [seatId, occ] of next) {
        if (occ.enrollmentId === row.enrollmentId && seatId !== row.seatId) {
          next.delete(seatId);
        }
      }
      next.set(row.seatId, row);
      return next;
    });
  }, []);

  // DELETE payloads carry only the primary key (replica identity default),
  // so eviction is by check-in id, not seat.
  const evictById = useCallback((checkInId: string) => {
    setOccupants((prev) => {
      for (const [seatId, occ] of prev) {
        if (occ.id === checkInId) {
          const next = new Map(prev);
          next.delete(seatId);
          return next;
        }
      }
      return prev;
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
            id: string;
            enrollment_id: string;
            seat_id: string;
            verified: boolean;
            denied_count?: number;
            professor_confirmed_at?: string | null;
          };
          if (!rec?.seat_id) return;
          applyChange({
            id: rec.id,
            enrollmentId: rec.enrollment_id,
            seatId: rec.seat_id,
            verified: rec.verified,
            deniedCount: rec.denied_count ?? 0,
            professorConfirmed: rec.professor_confirmed_at != null,
          });
          // Someone we don't have in the directory (activated after load).
          if (!directory[rec.enrollment_id] && !unknownEnrollment.current) {
            unknownEnrollment.current = true;
            router.refresh();
          }
        }
      )
      // DELETEs are subscribed separately and UNFILTERED: with replica
      // identity default the old row is just { id }, which has no session_id
      // for the filter to match — a filtered channel may never deliver them.
      // Eviction is id-keyed, so deletes from other sessions no-op harmlessly.
      // This is what clears a freed seat (releaseSeat) and the vanishing half
      // of a professor's swap on everyone else's map.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "check_ins" },
        (payload) => {
          const oldId = (payload.old as { id?: string } | null)?.id;
          if (oldId) evictById(oldId);
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
  }, [sessionId, applyChange, evictById, directory, router]);

  /**
   * Tap an open seat: check in, or — if already checked in — move there.
   *
   * The move case is why a mis-tap used to displace two people. There was no
   * way to leave a seat, so the student who took the wrong one stayed put and
   * its rightful occupant had to go elsewhere.
   */
  /**
   * Professor: tap an occupied seat to open its action card (confirm
   * attendance / free the seat). Tapping used to release immediately, which
   * meant one accidental tap erased a student's attendance — the card puts a
   * deliberate step in front of the destructive half, and it's the touch
   * path to confirmation on a tablet, where the hover card can't exist.
   */
  function handleProfessorTap(seat: { id: string; label: string }) {
    if (!sessionId || pendingSeat) return;
    if (!occupants.get(seat.id)) return;
    setActionSeatId(seat.id);
  }

  /** Professor: empty a seat, from the action card. */
  async function freeSeat(seat: { id: string; label: string }) {
    if (!sessionId || pendingSeat) return;
    const occupant = occupants.get(seat.id);
    if (!occupant) return;

    const previous = occupants;
    const who = directory[occupant.enrollmentId]?.name ?? "That student";

    setActionSeatId(null);
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

  /**
   * Professor: vouch for a student from the map. The ring greens
   * optimistically; the realtime echo of the RPC's UPDATE makes it stick on
   * every other screen. No seat_verification is written — this is attendance
   * integrity, not social credit, so people-met counts don't move.
   */
  async function confirmAttendance(seat: { id: string; label: string }) {
    if (!sessionId || confirmBusy) return;
    const occupant = occupants.get(seat.id);
    if (!occupant) return;

    const previous = occupants;
    const who = directory[occupant.enrollmentId]?.name ?? "That student";

    setConfirmBusy(true);
    setOccupants((prev) => {
      const next = new Map(prev);
      next.set(seat.id, { ...occupant, professorConfirmed: true, deniedCount: 0 });
      return next;
    });

    const result = await professorConfirmAttendance(
      sessionId,
      occupant.enrollmentId
    );
    setConfirmBusy(false);
    setActionSeatId(null);

    if (result.ok) {
      capture("professor_confirmed_attendance");
      toast.success(`${who.split(/\s+/)[0]} confirmed.`);
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
        // A fresh check-in's row id arrives with the realtime echo; until
        // then an empty id just can't match any DELETE eviction.
        id: myCheckIn?.id ?? "",
        enrollmentId: myEnrollmentId,
        seatId: seat.id,
        verified: myCheckIn?.verified ?? false,
        // A seat change moots any denial (the DB does the same server-side).
        deniedCount: 0,
        professorConfirmed: myCheckIn?.professorConfirmed ?? false,
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

  async function handleVerify(
    subjectEnrollmentId: string,
    relation: SeatRelation
  ): Promise<boolean> {
    if (!sessionId) return false;
    const result = await verifyNeighbor(sessionId, subjectEnrollmentId, relation);
    if (result.ok) {
      capture("neighbor_verified", { relation });
      setConfirmed((prev) => new Set(prev).add(subjectEnrollmentId));
      toast.success(
        result.data?.firstEverMet
          ? "Confirmed. You've officially met."
          : "Confirmed."
      );
      return true;
    }
    toast.error(result.error);
    return false;
  }

  async function handleDeny(
    subjectEnrollmentId: string,
    relation: SeatRelation
  ): Promise<boolean> {
    if (!sessionId) return false;
    const result = await denyNeighbor(sessionId, subjectEnrollmentId, relation);
    if (result.ok) {
      capture("neighbor_denied", { relation });
      setDeniedByMe((prev) => new Set(prev).add(subjectEnrollmentId));
      return true;
    }
    toast.error(result.error);
    return false;
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

  // Neighbor prompts: adjacent, checked-in, not yet confirmed (or reported)
  // by me. First-ever pairs get the introduction treatment; repeats get the
  // quiet one-tap row.
  const neighborPrompts: NeighborPromptRow[] = [];
  if (mySeat) {
    (["front", "back", "left", "right"] as SeatRelation[]).forEach((relation) => {
      const neighborLabel = mySeat.neighbors?.[relation];
      const seat = neighborLabel ? seatByLabel.get(neighborLabel) : undefined;
      if (!seat) return;
      const occupant = occupants.get(seat.id);
      if (!occupant || occupant.enrollmentId === myEnrollmentId) return;
      if (confirmed.has(occupant.enrollmentId)) return;
      if (deniedByMe.has(occupant.enrollmentId)) return;
      const entry = directory[occupant.enrollmentId];
      neighborPrompts.push({
        relation,
        seatLabel: seat.label,
        enrollmentId: occupant.enrollmentId,
        name: entry?.name ?? null,
        firstName: entry?.firstName ?? null,
        photoUrl: entry?.photoUrl ?? null,
        firstEver: !metBefore.has(occupant.enrollmentId),
        fact: neighborFacts[occupant.enrollmentId] ?? null,
      });
    });
  }

  // The confirmation ring for an occupied seat, derived the same way on
  // every screen — including the professor's projection — from data already
  // on the wire. "Could a peer vouch for them?" is read from the seat's own
  // neighbor links against current occupancy.
  function ringFor(seat: SeatInfo | undefined, occupant: OccupantInfo): SeatRing {
    let hasOccupiedAdjacentSeat = false;
    for (const relation of ["front", "back", "left", "right"] as const) {
      const label = seat?.neighbors?.[relation];
      const neighborSeat = label ? seatByLabel.get(label) : undefined;
      const neighborOccupant = neighborSeat
        ? occupants.get(neighborSeat.id)
        : undefined;
      if (
        neighborOccupant &&
        neighborOccupant.enrollmentId !== occupant.enrollmentId
      ) {
        hasOccupiedAdjacentSeat = true;
        break;
      }
    }
    return deriveSeatRing({
      verified: occupant.verified,
      professorConfirmed: occupant.professorConfirmed,
      deniedCount: occupant.deniedCount,
      hasOccupiedAdjacentSeat,
    });
  }

  // Every click is an independent draw — repeats included. Students who've
  // already answered stay in the pool on purpose: knowing they could be
  // called again is what keeps the room paying attention.
  function handleColdCall() {
    if (!sessionId) return;
    const present = Array.from(occupants.values());
    if (present.length === 0) return;
    const pick = present[Math.floor(Math.random() * present.length)];
    setSpotlight({ sessionId, enrollmentId: pick.enrollmentId });
    const name = directory[pick.enrollmentId]?.name ?? "A student";
    const label = seats.find((s) => s.id === pick.seatId)?.label;
    toast.success(label ? `${name} — seat ${label}` : name);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {mySeat && myCheckIn ? (
            <Badge>
              Your seat: {mySeat.label}
              {(() => {
                switch (ringFor(mySeat, myCheckIn)) {
                  case "confirmed":
                    return " · confirmed";
                  case "denied":
                    return " · seat disputed — are you in the right seat?";
                  case "unconfirmable":
                    return " · no neighbors yet";
                  default:
                    return " · awaiting a neighbor";
                }
              })()}
            </Badge>
          ) : (
            <Badge variant="secondary">Tap an open seat to check in</Badge>
          )}
          <Badge variant="outline">Networking score: {score}</Badge>
        </div>
        {!live && (
          <Badge variant="secondary" className="animate-pulse">
            Reconnecting — updates every few seconds
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

      <div className="relative overflow-x-auto rounded-lg border p-4">
        {canReassign && sessionId && (
          <Button
            variant="outline"
            size="sm"
            // z-30 clears the designer table handles (z-20); the professor map
            // uses `fit`, so this container never actually scrolls and the
            // button stays pinned to the visible corner.
            className="absolute right-2 top-2 z-30 h-7 gap-1 px-2 text-xs"
            disabled={occupants.size === 0}
            onClick={handleColdCall}
          >
            <Dices className="h-3.5 w-3.5" />
            Random student
          </Button>
        )}
        <RoomMap
          seats={seats}
          onSeatTap={handleSeatTap}
          captions={canReassign}
          flipped={canReassign || studentFlipped}
          perspective={canReassign}
          fit={canReassign}
          photoZoom={canReassign}
          podium
          frontLabel={
            canReassign
              ? "You are here — front of room"
              : studentFlipped
                ? "Front of room (behind you)"
                : "Front of room"
          }
          hoverContent={
            canReassign && sessionId
              ? (seat, state) => {
                  const occupant = occupants.get(seat.id);
                  if (!occupant) return null;
                  const seatInfo = seatByLabel.get(seat.label);
                  return (
                    <SeatActionCard
                      name={state.name ?? null}
                      photoUrl={state.photoUrl ?? null}
                      seatLabel={seat.label}
                      ring={ringFor(seatInfo, occupant)}
                      deniedCount={occupant.deniedCount}
                      busy={confirmBusy || pendingSeat !== null}
                      onConfirm={() =>
                        confirmAttendance({ id: seat.id, label: seat.label })
                      }
                      onFree={() => freeSeat({ id: seat.id, label: seat.label })}
                    />
                  );
                }
              : undefined
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
              // The confirmation ring — the public answer to "has anyone
              // vouched for this person?", on every screen including the
              // projection. Session only: without one there is nothing to
              // confirm.
              ring:
                occupant && !isMine && sessionId
                  ? ringFor(seatByLabel.get(seat.label), occupant)
                  : undefined,
              name: entry?.name ?? (occupant ? "A classmate" : null),
              // Pinned so a re-signed URL from a page refresh doesn't make
              // the avatar flash while the browser refetches the same face.
              photoUrl: stablePhotoUrl(entry?.photoUrl),
              pending: pendingSeat === seat.id,
              // The professor taps an occupied seat to free it, so an empty
              // one does nothing. Students tap open seats — a check-in first,
              // a move afterwards.
              tappable: canReassign
                ? Boolean(occupant) && pendingSeat === null
                : !occupant && pendingSeat === null && Boolean(myEnrollmentId),
              caption: canReassign ? entry?.firstName : undefined,
              highlight: canReassign
                ? false
                : !occupant &&
                  !myCheckIn &&
                  Boolean(myEnrollmentId) &&
                  !mySeatSet.has(seat.id),
              spotlight:
                canReassign &&
                spotlightId !== null &&
                occupant?.enrollmentId === spotlightId,
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
          {sessionId && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-muted-foreground/20 ring-2 ring-green-500/80" />{" "}
                Confirmed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-muted-foreground/20 ring-2 ring-red-500/80" />{" "}
                Awaiting confirm
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-muted-foreground/20 ring-2 ring-amber-500/80" />{" "}
                No neighbor yet
              </span>
              {canReassign && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 animate-pulse rounded-sm bg-muted-foreground/20 ring-2 ring-red-600/80" />{" "}
                  Reported absent from seat
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {mySeat && (
        <NeighborPrompts
          rows={neighborPrompts}
          socialEndsAt={socialEndsAt}
          aloneInRoom={occupants.size <= 1}
          onVerify={handleVerify}
          onDeny={handleDeny}
        />
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

      {/* Professor: the tapped seat's action card — the touch path to
          confirm/free, and the deliberate step in front of releasing. */}
      {canReassign && (
        <Dialog
          open={actionSeatId !== null}
          onOpenChange={(open) => {
            if (!open) setActionSeatId(null);
          }}
        >
          <DialogContent className="max-w-xs">
            {(() => {
              if (!actionSeatId) return null;
              const occupant = occupants.get(actionSeatId);
              const seatInfo = seats.find((s) => s.id === actionSeatId);
              if (!occupant || !seatInfo) return null;
              const entry = directory[occupant.enrollmentId];
              return (
                <>
                  <DialogTitle className="sr-only">
                    Seat {seatInfo.label}
                  </DialogTitle>
                  <div className="flex justify-center">
                    <SeatActionCard
                      name={entry?.name ?? null}
                      photoUrl={stablePhotoUrl(entry?.photoUrl)}
                      seatLabel={seatInfo.label}
                      ring={ringFor(seatInfo, occupant)}
                      deniedCount={occupant.deniedCount}
                      busy={confirmBusy || pendingSeat !== null}
                      onConfirm={() =>
                        confirmAttendance({ id: seatInfo.id, label: seatInfo.label })
                      }
                      onFree={() =>
                        freeSeat({ id: seatInfo.id, label: seatInfo.label })
                      }
                    />
                  </div>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
