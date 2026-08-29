"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/server/actions/auth";
import { flagAbsencesElsewhere } from "@/server/absences";
import { timed } from "@/server/loadmetrics";
import { canReleaseSeat } from "@/lib/seatrelease";
import { rosterDisplayName } from "@/lib/names";
import {
  seatMoveOutcome,
  SEAT_MOVE_MESSAGES,
  type SeatMoveError,
} from "@/lib/seatmove";
import type { SeatNeighbors, SeatRelation } from "@/types/db";

/** Today's date in the server's local calendar, YYYY-MM-DD. */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Professor: open (or reuse) today's session (FR-008, idempotent). */
export async function openSession(
  courseId: string
): Promise<ActionResult<{ sessionId: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Only the course owner can open a session." };
  }

  const sessionDate = todayDate();
  const { data: existing } = await supabase
    .from("class_sessions")
    .select("id, closed_at")
    .eq("course_id", courseId)
    .eq("session_date", sessionDate)
    .maybeSingle();

  if (existing) {
    if (existing.closed_at) {
      await supabase
        .from("class_sessions")
        .update({ closed_at: null })
        .eq("id", existing.id);
    }
    revalidatePath(`/course/${courseId}`);
    return { ok: true, data: { sessionId: existing.id } };
  }

  const { data: created, error } = await supabase
    .from("class_sessions")
    .insert({ course_id: courseId, session_date: sessionDate })
    .select("id")
    .single();
  if (error || !created) {
    return { ok: false, error: "Couldn't open the session. Try again." };
  }
  revalidatePath(`/course/${courseId}`);
  return { ok: true, data: { sessionId: created.id } };
}

/** Professor: close today's session. */
export async function closeSession(
  courseId: string,
  sessionId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("course_id", courseId); // RLS restricts to owner
  if (error) return { ok: false, error: "Couldn't close the session." };
  revalidatePath(`/course/${courseId}`);
  return { ok: true };
}

export type CheckInError =
  | "seat_taken"
  | "already_checked_in"
  | "no_session"
  | "unknown";

/**
 * Student: claim a seat (FR-009). Atomicity comes from the DB unique
 * constraints — no app-level locking. 23505 on (session_id, seat_id) means
 * someone beat you to the seat; on (session_id, enrollment_id) you already
 * checked in.
 */
export async function checkIn(
  sessionId: string,
  seatId: string
): Promise<
  ActionResult<{ checkInId: string; isNewSeat: boolean }> & {
    code?: CheckInError;
  }
> {
  // Measured because this is the one path a whole room hits inside the same
  // sixty seconds. `dbCode` carries the raw SQLSTATE out of the closure so
  // contention (40P01 deadlock, 55P03 lock unavailable, 53300 connections
  // exhausted) is counted as itself rather than as a generic failure.
  let dbCode: string | undefined;

  return timed(
    "checkin",
    { sessionId },
    () =>
      runCheckIn(sessionId, seatId, (code) => {
        dbCode = code;
      }),
    (result) => ({
      ok: result.ok,
      code: dbCode ?? (result.ok ? undefined : result.code),
    })
  );
}

async function runCheckIn(
  sessionId: string,
  seatId: string,
  onDbError: (code: string) => void
): Promise<
  ActionResult<{ checkInId: string; isNewSeat: boolean }> & {
    code?: CheckInError;
  }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first.", code: "unknown" };

  // Resolve the session + my enrollment in that course.
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, course_id, closed_at, session_date")
    .eq("id", sessionId)
    .single();
  if (!session || session.closed_at) {
    return {
      ok: false,
      error: "Class hasn't started yet — check in once your professor opens the session.",
      code: "no_session",
    };
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", session.course_id)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return {
      ok: false,
      error: "You're not on this course's active roster yet.",
      code: "unknown",
    };
  }

  // Networking point: is this a seat I've never used in this course?
  const { data: priorSeats } = await supabase
    .from("check_ins")
    .select("seat_id")
    .eq("enrollment_id", enrollment.id);
  const isNewSeat = !(priorSeats ?? []).some((p) => p.seat_id === seatId);

  const { data: created, error } = await supabase
    .from("check_ins")
    .insert({
      session_id: sessionId,
      enrollment_id: enrollment.id,
      seat_id: seatId,
      is_new_seat: isNewSeat,
    })
    .select("id")
    .single();

  if (error) {
    onDbError(error.code ?? "unknown");
    if (error.code === "23505") {
      const detail = `${error.message} ${error.details ?? ""}`;
      if (detail.includes("enrollment")) {
        return {
          ok: false,
          error: "You're already checked in for today.",
          code: "already_checked_in",
        };
      }
      return {
        ok: false,
        error: "Seat just taken — pick another.",
        code: "seat_taken",
      };
    }
    return { ok: false, error: "Check-in failed. Try again.", code: "unknown" };
  }

  // Showed up here today? Then any absence they reported for today in
  // another ClassAct class gets flagged for that professor. Best-effort.
  await flagAbsencesElsewhere(user.id, session.course_id, session.session_date);

  return { ok: true, data: { checkInId: created.id, isNewSeat } };
}

/**
 * Student: confirm a present neighbor (FR-011). Server verifies adjacency
 * from seat coordinates; the DB trigger flips the subject's check-in to
 * verified.
 *
 * An UPSERT, not an insert-and-shrug. The 0036 verification trigger is what
 * clears an active denial, and it fires on INSERT OR UPDATE — a duplicate
 * insert swallowed as 23505 fires nothing, which would leave a mis-tapped
 * denial pulsing forever with no student able to clear it. The conflict path
 * refreshes `relation`, since the pair may sit differently than they first
 * did.
 *
 * Returns whether this was the pair's first meeting EVER (any session,
 * either direction) so the caller can celebrate accordingly.
 */
export async function verifyNeighbor(
  sessionId: string,
  subjectEnrollmentId: string,
  relation: SeatRelation
): Promise<ActionResult<{ firstEverMet: boolean }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, course_id, closed_at")
    .eq("id", sessionId)
    .single();
  if (!session) return { ok: false, error: "Session not found." };
  if (session.closed_at) {
    return { ok: false, error: "Class has ended — confirmations are closed." };
  }

  const { data: me } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", session.course_id)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!me) return { ok: false, error: "You're not in this course." };

  // Both parties must be checked in; subject must occupy an adjacent seat.
  // Adjacency comes from the seat's persisted neighbor links, so this works
  // for any room shape — grids, curved auditorium rows, seminar tables.
  const { data: checkins } = await supabase
    .from("check_ins")
    .select("enrollment_id, seat_id, seats(label, neighbors)")
    .eq("session_id", sessionId)
    .in("enrollment_id", [me.id, subjectEnrollmentId]);

  const mine = (checkins ?? []).find((c) => c.enrollment_id === me.id);
  const theirs = (checkins ?? []).find(
    (c) => c.enrollment_id === subjectEnrollmentId
  );
  if (!mine) return { ok: false, error: "Check in before confirming neighbors." };
  if (!theirs) return { ok: false, error: "They haven't checked in yet." };

  const mySeat = mine.seats as unknown as {
    label: string;
    neighbors: SeatNeighbors;
  };
  const theirSeat = theirs.seats as unknown as { label: string };
  const expected = (mySeat.neighbors ?? {})[relation];
  if (!expected || expected !== theirSeat.label) {
    return { ok: false, error: "That person isn't in that seat." };
  }

  // Have these two ever confirmed each other before, in any session? Probed
  // before the write so the answer means "first meeting", not "row existed".
  const { data: priorMeeting } = await supabase
    .from("seat_verifications")
    .select("id")
    .or(
      `and(verifier_enrollment_id.eq.${me.id},subject_enrollment_id.eq.${subjectEnrollmentId}),` +
        `and(verifier_enrollment_id.eq.${subjectEnrollmentId},subject_enrollment_id.eq.${me.id})`
    )
    .limit(1);
  const firstEverMet = (priorMeeting ?? []).length === 0;

  const { error } = await supabase.from("seat_verifications").upsert(
    {
      session_id: sessionId,
      verifier_enrollment_id: me.id,
      subject_enrollment_id: subjectEnrollmentId,
      relation,
    },
    { onConflict: "session_id,verifier_enrollment_id,subject_enrollment_id" }
  );
  if (error) {
    return { ok: false, error: "Couldn't confirm — try again." };
  }
  return { ok: true, data: { firstEverMet } };
}

/**
 * Student: report that the person claiming an adjacent seat is not actually
 * in it — the live signature of a proxy check-in (someone checking in from
 * home on a friend's phone).
 *
 * Validation is deliberately identical to verifyNeighbor: the reporter must
 * be checked in, the subject must be checked in, and the claimed relation
 * must match the reporter's persisted neighbor links — so nobody can flag a
 * stranger across the room. The insert's trigger recounts the subject's
 * denied_count on check_ins, and THAT update is what reaches every client
 * (including the professor's projected map) over the existing realtime
 * subscription. The denial is quietly resolved the moment anyone confirms
 * the subject — peer or professor — or the subject moves seats.
 *
 * Idempotent per pair: a second report while one is active hits the partial
 * unique index and is treated as success.
 */
export async function denyNeighbor(
  sessionId: string,
  subjectEnrollmentId: string,
  relation: SeatRelation
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, course_id, closed_at")
    .eq("id", sessionId)
    .single();
  if (!session) return { ok: false, error: "Session not found." };
  if (session.closed_at) {
    return { ok: false, error: "Class has ended — reports are closed." };
  }

  const { data: me } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", session.course_id)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!me) return { ok: false, error: "You're not in this course." };
  if (subjectEnrollmentId === me.id) {
    return { ok: false, error: "You can't report your own seat." };
  }

  const { data: checkins } = await supabase
    .from("check_ins")
    .select("enrollment_id, seat_id, seats(label, neighbors)")
    .eq("session_id", sessionId)
    .in("enrollment_id", [me.id, subjectEnrollmentId]);

  const mine = (checkins ?? []).find((c) => c.enrollment_id === me.id);
  const theirs = (checkins ?? []).find(
    (c) => c.enrollment_id === subjectEnrollmentId
  );
  if (!mine) return { ok: false, error: "Check in before reporting a seat." };
  if (!theirs) return { ok: false, error: "They aren't checked in anymore." };

  const mySeat = mine.seats as unknown as {
    label: string;
    neighbors: SeatNeighbors;
  };
  const theirSeat = theirs.seats as unknown as { label: string };
  const expected = (mySeat.neighbors ?? {})[relation];
  if (!expected || expected !== theirSeat.label) {
    return { ok: false, error: "That seat isn't next to yours." };
  }

  const { error } = await supabase.from("seat_denials").insert({
    session_id: sessionId,
    verifier_enrollment_id: me.id,
    subject_enrollment_id: subjectEnrollmentId,
    relation,
  });
  if (error && error.code !== "23505") {
    // 42P01 = table missing: 0036 hasn't been applied yet.
    if (error.code === "42P01") {
      return {
        ok: false,
        error:
          "Seat reports aren't installed on the database yet — run migration 0036_neighbor_denials.sql.",
      };
    }
    return { ok: false, error: "Couldn't send that report — try again." };
  }
  return { ok: true };
}

/**
 * Student: move to a different seat after already checking in (CA-4).
 *
 * An UPDATE of the existing row, never a delete-and-reinsert. That is what
 * guarantees Mike's requirement that a corrected seat costs nobody their
 * attendance: the check-in — and any neighbor verification already on it —
 * survives the move untouched.
 *
 * Atomicity comes from the same unique constraint the first check-in relies
 * on: 23505 on (session_id, seat_id) means someone claimed the target between
 * our occupancy check and the write. The pre-check exists to give a good
 * message in the common case; the constraint is what actually prevents two
 * people landing in one seat.
 *
 * `is_new_seat` is recomputed for the seat they end up in, excluding this very
 * row. Credit should describe where they actually sat, and since there is only
 * ever one check-in row per student per session, this can swing their
 * networking score by at most one point — there is nothing to farm here.
 */
export async function moveSeat(
  sessionId: string,
  seatId: string
): Promise<ActionResult<{ isNewSeat: boolean }> & { code?: SeatMoveError }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, course_id, closed_at")
    .eq("id", sessionId)
    .single();

  const { data: enrollment } = session
    ? await supabase
        .from("enrollments")
        .select("id")
        .eq("course_id", session.course_id)
        .eq("profile_id", user.id)
        .eq("status", "active")
        .maybeSingle()
    : { data: null };

  const { data: mine } = enrollment
    ? await supabase
        .from("check_ins")
        .select("id, seat_id")
        .eq("session_id", sessionId)
        .eq("enrollment_id", enrollment.id)
        .maybeSingle()
    : { data: null };

  const { data: occupant } = await supabase
    .from("check_ins")
    .select("id")
    .eq("session_id", sessionId)
    .eq("seat_id", seatId)
    .maybeSingle();

  const verdict = seatMoveOutcome({
    sessionOpen: Boolean(session) && !session?.closed_at,
    hasCheckIn: Boolean(mine),
    targetIsCurrentSeat: mine?.seat_id === seatId,
    targetOccupied: Boolean(occupant),
  });
  if (!verdict.allowed) {
    return {
      ok: false,
      error: SEAT_MOVE_MESSAGES[verdict.code],
      code: verdict.code,
    };
  }
  if (!mine) return { ok: false, error: SEAT_MOVE_MESSAGES.not_checked_in };

  // Have they sat here before, ignoring the row we're about to change?
  const { data: priorSeats } = await supabase
    .from("check_ins")
    .select("seat_id")
    .eq("enrollment_id", enrollment!.id)
    .neq("id", mine.id);
  const isNewSeat = !(priorSeats ?? []).some((p) => p.seat_id === seatId);

  const { error } = await supabase
    .from("check_ins")
    .update({ seat_id: seatId, is_new_seat: isNewSeat })
    .eq("id", mine.id);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: SEAT_MOVE_MESSAGES.seat_taken,
        code: "seat_taken",
      };
    }
    return { ok: false, error: "Couldn't move you. Try again." };
  }

  revalidatePath(`/course/${session!.course_id}/checkin`);
  return { ok: true, data: { isNewSeat } };
}

/** Why a professor's reassignment was refused, mapped from the RPC's SQLSTATEs. */
const REASSIGN_MESSAGES: Record<string, string> = {
  "42501": "Only the course's professor can move students.",
  P0002: "That session no longer exists.",
  P0003: "Class has ended — seats are locked for today.",
  P0004: "That seat isn't in this room.",
  P0005: "That student isn't on this course's roster.",
  P0006:
    "That seat is taken and this student has no seat to swap. Move the current occupant first.",
};

/**
 * Professor: put a student in a seat, mid-class (CA-4c).
 *
 * Handles the three cases the room actually produces: seating someone who
 * hasn't checked in, moving someone to a free seat, and — the one that
 * matters — swapping a mis-seated student with whoever's seat they took.
 *
 * All of it happens inside `reassign_seat`, a single atomic statement. The
 * swap has to delete a row and write it back, and doing that as separate
 * client calls would leave a window where a failure erases a student's
 * attendance for good. Authorization lives in the function too, since
 * professors have no UPDATE policy on check_ins.
 */
export async function reassignSeat(
  sessionId: string,
  enrollmentId: string,
  seatId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("reassign_seat", {
    p_session: sessionId,
    p_enrollment: enrollmentId,
    p_seat: seatId,
  });

  if (error) {
    const known = error.code ? REASSIGN_MESSAGES[error.code] : undefined;
    if (known) return { ok: false, error: known };
    // 42883 = function doesn't exist: 0029 hasn't been applied yet. Say so
    // rather than letting a professor conclude the feature is broken.
    if (error.code === "42883") {
      return {
        ok: false,
        error:
          "Seat reassignment isn't installed on the database yet — run migration 0029_reassign_seat.sql.",
      };
    }
    console.error("[reassign] failed:", { code: error.code, message: error.message });
    return { ok: false, error: "Couldn't move that student. Try again." };
  }

  return { ok: true };
}

/** Why a professor's confirmation was refused, mapped from the RPC's SQLSTATEs. */
const CONFIRM_MESSAGES: Record<string, string> = {
  "42501": "Only the course's professor can confirm attendance.",
  P0002: "That session no longer exists.",
  P0003: "Class has ended — attendance is locked for today.",
  P0007: "That student isn't checked in.",
};

/**
 * Professor: vouch for a student's presence from the map.
 *
 * The peer system can't cover everyone — edge seats with no neighbors,
 * ignored prompts, or a disputed seat the professor can settle with their
 * own eyes. This is the backstop: it turns the ring green and resolves any
 * active denials, but it deliberately writes NO seat_verifications row, so
 * it never counts as anyone "meeting" anyone — attendance integrity, not
 * social credit.
 *
 * A SECURITY DEFINER RPC for the same reason as reassign_seat: professors
 * have no enrollment and no UPDATE policy on check_ins, and the function is
 * the authorization boundary.
 */
export async function professorConfirmAttendance(
  sessionId: string,
  enrollmentId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("professor_confirm_attendance", {
    p_session: sessionId,
    p_enrollment: enrollmentId,
  });

  if (error) {
    const known = error.code ? CONFIRM_MESSAGES[error.code] : undefined;
    if (known) return { ok: false, error: known };
    // 42883 = function doesn't exist: 0036 hasn't been applied yet. Say so
    // rather than letting a professor conclude the feature is broken.
    if (error.code === "42883") {
      return {
        ok: false,
        error:
          "Attendance confirmation isn't installed on the database yet — run migration 0036_neighbor_denials.sql.",
      };
    }
    console.error("[confirm] failed:", { code: error.code, message: error.message });
    return { ok: false, error: "Couldn't confirm that student. Try again." };
  }

  return { ok: true };
}

/**
 * Professor: empty a seat during a live class (CA-4c).
 *
 * The simple half of seat correction. Someone checked into a seat they aren't
 * sitting in — or checked in and left — and the professor frees it; the
 * student checks back in wherever they actually are. No swap, no second
 * student to place, nothing to make atomic.
 *
 * Deletes the check-in, so the student has no attendance for this session
 * until they check in again. That is the point when they aren't here, and it
 * resolves itself in seconds when they are.
 */
export async function releaseSeat(
  sessionId: string,
  seatId: string
): Promise<ActionResult<{ name: string | null }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, course_id, closed_at")
    .eq("id", sessionId)
    .single();
  if (!session) return { ok: false, error: "Session not found." };

  // Only the course owner. RLS lets a student delete nothing here, but the
  // check is explicit because this removes someone else's attendance.
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", session.course_id)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Only the course's professor can free a seat." };
  }

  const { data: occupant } = await supabase
    .from("check_ins")
    .select("id, enrollment_id")
    .eq("session_id", sessionId)
    .eq("seat_id", seatId)
    .maybeSingle();

  const verdict = canReleaseSeat({
    sessionOpen: !session.closed_at,
    occupied: Boolean(occupant),
  });
  if (!verdict.allowed) return { ok: false, error: verdict.reason };

  // Scoped to the row we actually looked at, so a check-in that arrived in
  // between isn't deleted instead of the one the professor tapped.
  const { error } = await supabase
    .from("check_ins")
    .delete()
    .eq("id", occupant!.id);
  if (error) return { ok: false, error: "Couldn't free that seat. Try again." };

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("roster_name")
    .eq("id", occupant!.enrollment_id)
    .maybeSingle();

  revalidatePath(`/course/${session.course_id}/checkin`);
  // The toast naming who was freed shows on a projected page, so it gets the
  // class-visible name rather than a code-joiner's email address.
  return {
    ok: true,
    data: {
      name: enrollment
        ? (rosterDisplayName(enrollment.roster_name) || null)
        : null,
    },
  };
}
