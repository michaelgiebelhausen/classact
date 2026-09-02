"use client";

/**
 * The course-wide tap on the shoulder.
 *
 * The confirm card can only reach a student who is looking at the check-in
 * page, and the page's own CTA sends them to the name games — so the moment
 * the whole neighbor mechanic depends on ("someone just sat down next to
 * you") used to pass in silence. This listener lives in the COURSE layout,
 * outside any one page, so the toast finds a seated student anywhere in the
 * course app, games included, with a one-tap confirm that never navigates.
 *
 * It renders nothing. It is mounted only for enrolled students while a
 * session is open and the social window could still be running; the layout
 * withholds it from professors and from courses with nothing live. All the
 * decision rules live in lib/arrivals.ts, tested; this component is wiring.
 *
 * Realtime discipline: its channel (`arrivals:<sessionId>`) is separate from
 * CheckInLive's, and its degraded fallback polls the check_ins TABLE — a
 * layout-level component must never router.refresh() on a timer, or forty
 * phones would multiply the full-page refresh storm the check-in page
 * already works to avoid. It is also the only arrival-toaster anywhere, the
 * check-in page included, so a double toast is structurally impossible.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/browser";
import {
  CHECKINS_LIVE_EVENT,
  checkInsLiveTopic,
  type CheckInChange,
} from "@/lib/checkinsync";
import { verifyNeighbor } from "@/server/actions/checkin";
import { capture } from "@/lib/analytics";
import {
  decideArrivalToast,
  isSocialMode,
  type ArrivalSeat,
} from "@/lib/arrivals";
import { relationPhrase } from "@/lib/seatrings";
import { firstNameOf } from "@/lib/names";
import type { SeatRelation } from "@/types/db";

interface SlimOccupant {
  id: string;
  enrollmentId: string;
  seatId: string;
}

interface Props {
  sessionId: string;
  myEnrollmentId: string;
  seats: ArrivalSeat[];
  initialOccupants: SlimOccupant[];
  /** People I've confirmed with in any session, ever. */
  metBeforeIds: string[];
  /** enrollment id → full name. Names only — photos stay on their pages. */
  names: Record<string, string>;
  /** ISO instant when the social window closes. */
  socialEndsAt: string;
}

/** Arrivals inside this window collapse into one summary toast. */
const COLLAPSE_MS = 6000;

export function NeighborArrivalListener({
  sessionId,
  myEnrollmentId,
  seats,
  initialOccupants,
  metBeforeIds,
  names,
  socialEndsAt,
}: Props) {
  const router = useRouter();

  // Everything lives in refs: this component renders nothing, so re-renders
  // would be pure overhead, and the realtime handler needs current values
  // without resubscribing.
  const occupantsRef = useRef<Map<string, SlimOccupant>>(new Map());
  const metBeforeRef = useRef<Set<string>>(new Set());
  const confirmedRef = useRef<Set<string>>(new Set());
  const toastedRef = useRef<Set<string>>(new Set());
  const windowRef = useRef<{ at: number; names: string[] }>({ at: 0, names: [] });
  const lastToastIdRef = useRef<string | null>(null);
  // Fresh prop identities arrive with every layout re-render (any
  // router.refresh() in the course re-runs the layout); going through refs
  // keeps the channel subscription from tearing down and resubscribing each
  // time content that hasn't actually changed comes back in a new object.
  const seatsRef = useRef(seats);
  const namesRef = useRef(names);

  useEffect(() => {
    seatsRef.current = seats;
    namesRef.current = names;
    metBeforeRef.current = new Set(metBeforeIds);
    // Merge rather than replace: the server snapshot doesn't know about
    // rows that arrived over realtime since it was taken.
    for (const o of initialOccupants) {
      const existing = occupantsRef.current.get(o.seatId);
      if (!existing || existing.id !== o.id) occupantsRef.current.set(o.seatId, o);
    }
  }, [seats, names, initialOccupants, metBeforeIds]);

  useEffect(() => {
    const endsAt = new Date(socialEndsAt);
    if (!isSocialMode(endsAt, new Date())) return;

    const supabase = createClient();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const firstName = (enrollmentId: string) =>
      firstNameOf(namesRef.current[enrollmentId] ?? "A classmate");

    const mySeatId = () => {
      for (const occ of occupantsRef.current.values()) {
        if (occ.enrollmentId === myEnrollmentId) return occ.seatId;
      }
      return null;
    };

    const confirmFromToast = (enrollmentId: string, relation: SeatRelation) => {
      confirmedRef.current.add(enrollmentId);
      toast.promise(
        verifyNeighbor(sessionId, enrollmentId, relation).then((result) => {
          if (!result.ok) {
            confirmedRef.current.delete(enrollmentId);
            throw new Error(result.error);
          }
          capture("neighbor_verified", { relation, via: "toast" });
          // If the check-in page is mounted somewhere behind this, its card
          // reconciles on the refresh; anywhere else this is a no-op-ish
          // re-render. One refresh per human tap.
          router.refresh();
          return result;
        }),
        {
          loading: "Confirming…",
          success: "Confirmed. You've officially met.",
          error: (e: Error) =>
            e.message || "Couldn't confirm — find them on the check-in page.",
        }
      );
    };

    const maybeToast = (arrival: SlimOccupant) => {
      const decision = decideArrivalToast(
        {
          myEnrollmentId,
          mySeatId: mySeatId(),
          seats: seatsRef.current,
          metBeforeIds: metBeforeRef.current,
          confirmedIds: confirmedRef.current,
          toastedIds: toastedRef.current,
          social: isSocialMode(endsAt, new Date()),
        },
        { enrollmentId: arrival.enrollmentId, seatId: arrival.seatId }
      );
      if (!decision.toast) return;

      toastedRef.current.add(decision.enrollmentId);
      capture("arrival_toast_shown", { relation: decision.relation });

      // A rush of arrivals collapses into one summary: three separate
      // "say hi!" toasts in six seconds is noise, not warmth.
      const now = Date.now();
      const win = windowRef.current;
      if (now - win.at > COLLAPSE_MS) {
        win.at = now;
        win.names = [];
      }
      win.names.push(firstName(decision.enrollmentId));

      if (win.names.length === 1) {
        const id = `arrival-${decision.enrollmentId}`;
        lastToastIdRef.current = id;
        toast(
          `${firstName(decision.enrollmentId)} just sat down ${relationPhrase(
            decision.relation,
            "theirs"
          )} — say hi!`,
          {
            id,
            duration: 15_000,
            action: {
              label: "They're here",
              onClick: () =>
                confirmFromToast(decision.enrollmentId, decision.relation),
            },
          }
        );
      } else {
        if (lastToastIdRef.current) toast.dismiss(lastToastIdRef.current);
        lastToastIdRef.current = null;
        toast(
          `${win.names.length} classmates just sat down around you — say hi!`,
          { id: "arrival-summary", duration: 15_000 }
        );
      }
    };

    // One row from any source (realtime or poll): update the map, and treat
    // a new or changed seat as an arrival. Status-only flips (a verified
    // UPDATE) change nothing here and never toast.
    const handleRow = (row: SlimOccupant) => {
      const prev = occupantsRef.current;
      let prevSeatId: string | null = null;
      for (const [seatId, occ] of prev) {
        if (occ.enrollmentId === row.enrollmentId) {
          prevSeatId = seatId;
          break;
        }
      }
      if (prevSeatId === row.seatId) return;
      if (prevSeatId) prev.delete(prevSeatId);
      prev.set(row.seatId, row);
      maybeToast(row);
    };

    const evictById = (checkInId: string) => {
      for (const [seatId, occ] of occupantsRef.current) {
        if (occ.id === checkInId) {
          occupantsRef.current.delete(seatId);
          return;
        }
      }
    };

    // The same broadcast the seat map follows (see checkInsLiveTopic): the
    // check-in actions publish each change after it lands, so arrivals reach
    // this listener without a per-subscriber policy check in the database.
    const channel = supabase
      .channel(checkInsLiveTopic(sessionId))
      .on(
        "broadcast",
        { event: CHECKINS_LIVE_EVENT },
        ({ payload }: { payload: CheckInChange }) => {
          if (!payload || !Array.isArray(payload.upsert)) return;
          for (const id of payload.delete ?? []) evictById(id);
          for (const rec of payload.upsert) {
            if (!rec?.seat_id) continue;
            handleRow({
              id: rec.id,
              enrollmentId: rec.enrollment_id,
              seatId: rec.seat_id,
            });
          }
        }
      )
      .subscribe((status) => {
        if (closed) return;
        const ok = status === "SUBSCRIBED";
        if (!ok && !pollTimer) {
          // Degraded: a scoped TABLE poll, never router.refresh() — a
          // layout-level refresh loop would multiply the very storm the
          // check-in page throttles.
          pollTimer = setInterval(async () => {
            const { data } = await supabase
              .from("check_ins")
              .select("id, enrollment_id, seat_id")
              .eq("session_id", sessionId);
            if (!data) return;
            const fresh = new Set(data.map((r) => r.id));
            for (const [seatId, occ] of occupantsRef.current) {
              if (!fresh.has(occ.id)) occupantsRef.current.delete(seatId);
            }
            for (const r of data) {
              handleRow({
                id: r.id,
                enrollmentId: r.enrollment_id,
                seatId: r.seat_id,
              });
            }
          }, 15_000);
        }
        if (ok && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      });

    // The boundary is one-way: when the scheduled minute arrives the whole
    // listener retires — quiet mode needs no arrival channel at all.
    const untilQuiet = Math.max(0, endsAt.getTime() - Date.now());
    const quietTimer = setTimeout(() => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      supabase.removeChannel(channel);
    }, untilQuiet);

    return () => {
      closed = true;
      clearTimeout(quietTimer);
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [sessionId, myEnrollmentId, socialEndsAt, router]);

  return null;
}
