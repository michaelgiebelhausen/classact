"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { neighborCoords } from "@/lib/seatlabels";
import type { ActionResult } from "@/server/actions/auth";
import type { SeatRelation } from "@/types/db";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first.", code: "unknown" };

  // Resolve the session + my enrollment in that course.
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, course_id, closed_at")
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

  return { ok: true, data: { checkInId: created.id, isNewSeat } };
}

/**
 * Student: confirm a present neighbor (FR-011). Server verifies adjacency
 * from seat coordinates; the DB trigger flips the subject's check-in to
 * verified.
 */
export async function verifyNeighbor(
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
    .select("id, course_id")
    .eq("id", sessionId)
    .single();
  if (!session) return { ok: false, error: "Session not found." };

  const { data: me } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", session.course_id)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!me) return { ok: false, error: "You're not in this course." };

  // Both parties must be checked in; subject must occupy an adjacent seat.
  const { data: checkins } = await supabase
    .from("check_ins")
    .select("enrollment_id, seat_id, seats(row_index, col_index)")
    .eq("session_id", sessionId)
    .in("enrollment_id", [me.id, subjectEnrollmentId]);

  const mine = (checkins ?? []).find((c) => c.enrollment_id === me.id);
  const theirs = (checkins ?? []).find(
    (c) => c.enrollment_id === subjectEnrollmentId
  );
  if (!mine) return { ok: false, error: "Check in before confirming neighbors." };
  if (!theirs) return { ok: false, error: "They haven't checked in yet." };

  const mySeat = mine.seats as unknown as { row_index: number; col_index: number };
  const theirSeat = theirs.seats as unknown as {
    row_index: number;
    col_index: number;
  };
  const expected = neighborCoords(mySeat.row_index, mySeat.col_index)[relation];
  if (
    expected.row !== theirSeat.row_index ||
    expected.col !== theirSeat.col_index
  ) {
    return { ok: false, error: "That person isn't in that seat." };
  }

  const { error } = await supabase.from("seat_verifications").insert({
    session_id: sessionId,
    verifier_enrollment_id: me.id,
    subject_enrollment_id: subjectEnrollmentId,
    relation,
  });
  if (error && error.code !== "23505") {
    return { ok: false, error: "Couldn't confirm — try again." };
  }
  return { ok: true };
}
