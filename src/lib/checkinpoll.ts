/**
 * The seat map's realtime fallback, as pure data.
 *
 * When a phone loses its realtime subscription mid-check-in, the map used to
 * recover by calling `router.refresh()` on a timer — a full server render of
 * the check-in page (a dozen queries plus the roster directory) every few
 * seconds, per phone, and in Next each refresh also re-armed the sidebar's
 * route prefetches. Forty phones dropping together turned that into the load
 * that froze the room. The fallback is now one scoped SELECT of the session's
 * check_ins, reconciled into the map here.
 */

export interface CheckInRow {
  id: string;
  enrollment_id: string;
  seat_id: string;
  verified: boolean;
  denied_count: number | null;
  professor_confirmed_at: string | null;
}

export interface OccupantLike {
  id: string;
  enrollmentId: string;
  seatId: string;
  verified: boolean;
  deniedCount: number;
  professorConfirmed: boolean;
}

export function rowToOccupant(row: CheckInRow): OccupantLike {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    seatId: row.seat_id,
    verified: row.verified,
    deniedCount: row.denied_count ?? 0,
    professorConfirmed: row.professor_confirmed_at != null,
  };
}

function sameOccupant(a: OccupantLike, b: OccupantLike): boolean {
  return (
    a.id === b.id &&
    a.enrollmentId === b.enrollmentId &&
    a.seatId === b.seatId &&
    a.verified === b.verified &&
    a.deniedCount === b.deniedCount &&
    a.professorConfirmed === b.professorConfirmed
  );
}

/**
 * Rebuild the seat→occupant map from an authoritative read. Returns `prev`
 * itself when nothing differs, so a setState with the result is a no-op
 * render. The server's rows win outright: anyone missing has left (or been
 * released), and a moved student appears only at their new seat.
 */
export function reconcileOccupants<T extends OccupantLike>(
  prev: Map<string, T>,
  rows: CheckInRow[]
): Map<string, T | OccupantLike> {
  const next = new Map<string, T | OccupantLike>();
  let changed = rows.length !== prev.size;
  for (const row of rows) {
    const occ = rowToOccupant(row);
    const existing = prev.get(occ.seatId);
    if (existing && sameOccupant(existing, occ)) {
      next.set(occ.seatId, existing);
    } else {
      next.set(occ.seatId, occ);
      changed = true;
    }
  }
  return changed ? next : prev;
}

/**
 * Apply one broadcast change (see lib/checkinsync): upsert the rows the
 * server read back, evict the ids it deleted. A moved student leaves their
 * old seat. Returns `prev` itself when nothing differs.
 */
export function applyCheckInBroadcast<T extends OccupantLike>(
  prev: Map<string, T>,
  change: { upsert: CheckInRow[]; delete: string[] }
): Map<string, T | OccupantLike> {
  const next = new Map<string, T | OccupantLike>(prev);
  let changed = false;
  if (change.delete.length > 0) {
    const gone = new Set(change.delete);
    for (const [seatId, occ] of next) {
      if (gone.has(occ.id)) {
        next.delete(seatId);
        changed = true;
      }
    }
  }
  for (const row of change.upsert) {
    const occ = rowToOccupant(row);
    for (const [seatId, existing] of next) {
      if (existing.enrollmentId === occ.enrollmentId && seatId !== occ.seatId) {
        next.delete(seatId);
        changed = true;
      }
    }
    const existing = next.get(occ.seatId);
    if (!existing || !sameOccupant(existing, occ)) {
      next.set(occ.seatId, occ);
      changed = true;
    }
  }
  return changed ? next : prev;
}
