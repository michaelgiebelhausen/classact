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
import { checkIn, verifyNeighbor } from "@/server/actions/checkin";
import { capture } from "@/lib/analytics";
import { neighborCoords } from "@/lib/seatlabels";
import type { SeatRelation } from "@/types/db";
import Link from "next/link";

export interface SeatInfo {
  id: string;
  label: string;
  row: number;
  col: number;
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
  const unknownEnrollment = useRef(false);

  const rows = useMemo(
    () => (seats.length > 0 ? Math.max(...seats.map((s) => s.row)) + 1 : 0),
    [seats]
  );
  const cols = useMemo(
    () => (seats.length > 0 ? Math.max(...seats.map((s) => s.col)) + 1 : 0),
    [seats]
  );
  const seatByCoord = useMemo(() => {
    const m = new Map<string, SeatInfo>();
    for (const s of seats) m.set(`${s.row}:${s.col}`, s);
    return m;
  }, [seats]);

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

  // Realtime subscription with 5s polling fallback (FR-010).
  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();
    let pollTimer: ReturnType<typeof setInterval> | null = null;

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
          pollTimer = setInterval(() => router.refresh(), 5000);
        }
        if (ok && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      });

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [sessionId, applyChange, directory, router]);

  async function handleSeatTap(seat: SeatInfo) {
    if (!sessionId || !myEnrollmentId || myCheckIn || pendingSeat) return;
    if (occupants.has(seat.id)) return;

    setPendingSeat(seat.id);
    // Optimistic fill, reconciled below.
    applyChange({ enrollmentId: myEnrollmentId, seatId: seat.id, verified: false });

    const result = await checkIn(sessionId, seat.id);
    setPendingSeat(null);

    if (result.ok && result.data) {
      capture("checkin_completed", { isNewSeat: result.data.isNewSeat });
      if (result.data.isNewSeat) {
        setScore((s) => s + 1);
        toast.success(`You're checked in, seat ${seat.label}. +1 networking point — new seat.`);
      } else {
        toast.success(`You're checked in, seat ${seat.label}.`);
      }
    } else {
      // Roll back the optimistic fill.
      setOccupants((prev) => {
        const next = new Map(prev);
        const current = next.get(seat.id);
        if (current?.enrollmentId === myEnrollmentId) next.delete(seat.id);
        return next;
      });
      toast.error(result.ok ? "Check-in failed." : result.error);
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

  if (!sessionId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Class hasn&apos;t started yet. The seat map opens when your professor
          starts today&apos;s session.
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
    const coords = neighborCoords(mySeat.row, mySeat.col);
    (Object.keys(coords) as SeatRelation[]).forEach((relation) => {
      const c = coords[relation];
      const seat = seatByCoord.get(`${c.row}:${c.col}`);
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

      <div className="overflow-x-auto rounded-lg border p-4">
        <p className="mb-3 text-center text-xs uppercase tracking-wide text-muted-foreground">
          Front of room
        </p>
        <div
          role="grid"
          aria-label="Classroom seat map"
          className="mx-auto grid w-max gap-1.5"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: rows * cols }, (_, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const seat = seatByCoord.get(`${row}:${col}`);
            if (!seat) return <div key={i} className="h-11 w-11" />;
            const occupant = occupants.get(seat.id);
            const isMine = occupant?.enrollmentId === myEnrollmentId;
            const entry = occupant ? directory[occupant.enrollmentId] : undefined;
            const stateLabel = occupant
              ? isMine
                ? "yours"
                : `taken by ${entry?.name ?? "a classmate"}`
              : "empty";
            return (
              <button
                key={seat.id}
                type="button"
                role="gridcell"
                aria-label={`Seat ${seat.label}, ${stateLabel}`}
                disabled={Boolean(occupant) || Boolean(myCheckIn) || pendingSeat !== null}
                onClick={() => handleSeatTap(seat)}
                className={[
                  "flex h-11 w-11 items-center justify-center rounded-md border text-[10px] font-medium transition-colors",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
                  isMine
                    ? "border-primary bg-primary text-primary-foreground"
                    : occupant
                      ? occupant.verified
                        ? "border-transparent bg-muted-foreground/30"
                        : "border-transparent bg-muted-foreground/15"
                      : myCheckIn
                        ? "bg-background text-muted-foreground/50"
                        : "bg-background hover:border-primary hover:text-primary",
                  pendingSeat === seat.id ? "animate-pulse" : "",
                ].join(" ")}
              >
                {occupant && entry ? (
                  <Avatar className="h-8 w-8">
                    {entry.photoUrl && (
                      <AvatarImage src={entry.photoUrl} alt={entry.name} />
                    )}
                    <AvatarFallback className="text-[9px]">
                      {initials(entry.name)}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  seat.label
                )}
              </button>
            );
          })}
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
