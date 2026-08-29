import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import {
  getSignedPhotoUrls,
  resolveEnrollmentPhotosByKind,
} from "@/lib/storage";
import { flashcardHintFields } from "@/lib/icebreakers";
import { resolveDisplayName } from "@/lib/names";
import { getCourseDirectory } from "@/lib/coursedirectory";
import { loadCourseSeats, type CourseSeat } from "@/server/courseseats";
import {
  isScheduleComplete,
  sessionDateFor,
  type CourseSchedule,
} from "@/lib/schedule";
import {
  NameGames,
  type GamePlayer,
  type RosterPerson,
} from "@/components/features/games/NameGames";
import type { LastSessionOccupant } from "@/components/features/checkin/LastSessionMap";
import type { PhotoKind } from "@/types/db";

const MIN_PLAYERS = 6;

export default async function GamesPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  // RLS membership gate.
  const { data: course } = await supabase
    .from("courses")
    .select(
      "id, name, icebreaker_fields, professor_id, room_id, meeting_days, meeting_start, meeting_end, timezone, term_start, term_end"
    )
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  // Build the player pool (classmates with >=1 photo, excluding yourself).
  // The Roster tab is a class list rather than a game, so it takes everyone —
  // a photo just isn't required to appear on it.
  const players: GamePlayer[] = [];
  const roster: RosterPerson[] = [];
  if (isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data: enrollments } = await admin
      .from("enrollments")
      .select("id, roster_name, profile_id, roster_photo_path, roster_name_phonetic")
      .eq("course_id", courseId);

    // Everyone but yourself; not-yet-activated students (null profile_id) are
    // included so their Canvas photo can seed the game.
    const candidates = (enrollments ?? []).filter(
      (e) => e.profile_id !== profile.id
    );
    // By kind, so the roster can offer "show me everyone's headshot" — a face
    // is easier to learn from more than one angle, and people don't always
    // look like their campus ID photo.
    const photoMap = await resolveEnrollmentPhotosByKind(admin, candidates);

    // Pronunciation guides, LinkedIn, and the name the student chose to be
    // known by, keyed by profile (activated students). The chosen name matters
    // here for the same reason the phonetic does: this is the page where the
    // class learns what to call each other, and roster_name for a code-joiner
    // is the email address they signed up with.
    const phoneticByProfile = new Map<string, string>();
    const linkedinByProfile = new Map<string, string>();
    const namesByProfile = new Map<
      string,
      { firstName: string | null; fullName: string | null }
    >();
    const activatedIds = candidates
      .map((e) => e.profile_id)
      .filter((id): id is string => Boolean(id));
    if (activatedIds.length > 0) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, name_phonetic, linkedin_url, first_name, full_name")
        .in("id", activatedIds);
      for (const p of profs ?? []) {
        if (p.name_phonetic) phoneticByProfile.set(p.id, p.name_phonetic);
        if (p.linkedin_url) linkedinByProfile.set(p.id, p.linkedin_url);
        namesByProfile.set(p.id, {
          firstName: p.first_name,
          fullName: p.full_name,
        });
      }
    }

    // Every flashcard-eligible icebreaker each classmate answered, in catalog
    // order. Flash cards show a rotating couple of them, so the same person
    // reveals different facts on different passes.
    const hintsByEnrollment = new Map<
      string,
      Array<{ label: string; value: string }>
    >();
    const hintFields = flashcardHintFields(course.icebreaker_fields ?? []);
    if (hintFields.length > 0 && candidates.length > 0) {
      const { data: answers } = await admin
        .from("student_answers")
        .select("enrollment_id, field_key, value")
        .in(
          "enrollment_id",
          candidates.map((e) => e.id)
        );
      const answersByEnrollment = new Map<string, Map<string, string>>();
      for (const a of answers ?? []) {
        const value = (a.value ?? "").trim();
        if (!value) continue;
        let m = answersByEnrollment.get(a.enrollment_id);
        if (!m) {
          m = new Map();
          answersByEnrollment.set(a.enrollment_id, m);
        }
        m.set(a.field_key, value);
      }
      for (const [enrollmentId, m] of answersByEnrollment) {
        const facts: Array<{ label: string; value: string }> = [];
        for (const f of hintFields) {
          const value = m.get(f.key);
          if (value) facts.push({ label: f.label, value });
        }
        if (facts.length > 0) hintsByEnrollment.set(enrollmentId, facts);
      }
    }

    // The professor is in the room too: students should learn their name and
    // face like anyone else's. Their photos and icebreaker answers hang off
    // the profile (no enrollment of their own), so they're fetched directly.
    if (course.professor_id !== profile.id) {
      const [{ data: profPhotos }, { data: prof }, { data: profAnswers }] =
        await Promise.all([
          admin
            .from("profile_photos")
            .select("storage_path, kind")
            .eq("profile_id", course.professor_id)
            .order("kind"),
          admin
            .from("profiles")
            .select("full_name, name_phonetic, linkedin_url")
            .eq("id", course.professor_id)
            .maybeSingle(),
          admin
            .from("profile_answers")
            .select("field_key, value")
            .eq("profile_id", course.professor_id),
        ]);
      const paths = (profPhotos ?? []).map((p) => p.storage_path);
      const urlMap = await getSignedPhotoUrls(admin, paths);
      const urls = paths
        .map((p) => urlMap[p])
        .filter((u): u is string => Boolean(u));
      const profByKind: Partial<Record<PhotoKind, string>> = {};
      for (const p of profPhotos ?? []) {
        const url = urlMap[p.storage_path];
        if (url) profByKind[p.kind] = url;
      }
      const profFacts: Array<{ label: string; value: string }> = [];
      {
        const answerByKey = new Map(
          (profAnswers ?? []).map((a) => [a.field_key, a.value])
        );
        for (const f of hintFields) {
          const value = answerByKey.get(f.key);
          if (value) profFacts.push({ label: f.label, value });
        }
      }
      // Only with a real name: professors who signed up with a password
      // never set full_name, and a card reading "Your professor" would file
      // under a fabricated surname with fabricated initials.
      if (prof?.full_name?.trim()) {
        roster.push({
          enrollmentId: `professor:${course.professor_id}`,
          name: prof.full_name,
          photoUrl: urls[0] ?? null,
          photosByKind: profByKind,
          rosterPhotoUrl: null,
          phonetic: prof.name_phonetic ?? null,
          hints: profFacts,
        });
      }
      if (urls.length > 0) {
        players.push({
          enrollmentId: `professor:${course.professor_id}`,
          name: prof?.full_name ?? "Your professor",
          photoUrls: urls,
          phonetic: prof?.name_phonetic ?? null,
          hints: profFacts,
          linkedinUrl: prof?.linkedin_url ?? null,
        });
      }
    }

    for (const e of candidates) {
      const photos = photoMap.get(e.id);
      const urls = photos?.urls ?? [];
      const phonetic =
        (e.profile_id ? phoneticByProfile.get(e.profile_id) : null) ??
        e.roster_name_phonetic ??
        null;
      // Full name, not first: learning to put a whole name to a face is the
      // point of the games.
      const { name } = resolveDisplayName(
        e.roster_name,
        e.profile_id ? namesByProfile.get(e.profile_id) : null
      );
      roster.push({
        enrollmentId: e.id,
        name,
        photoUrl: urls[0] ?? null,
        photosByKind: photos?.byKind ?? {},
        rosterPhotoUrl: photos?.rosterUrl ?? null,
        phonetic,
        // The same facts the flash cards reveal — so tapping a face on the
        // roster tells you what you'd have learned by playing.
        hints: hintsByEnrollment.get(e.id) ?? [],
      });
      if (urls.length > 0) {
        players.push({
          enrollmentId: e.id,
          name,
          photoUrls: urls,
          phonetic,
          hints: hintsByEnrollment.get(e.id) ?? [],
          linkedinUrl: e.profile_id
            ? (linkedinByProfile.get(e.profile_id) ?? null)
            : null,
        });
      }
    }
  }

  // Where everyone sat last time. The professor has had this on the check-in
  // page all along; it belongs here too, because "who was sitting near me"
  // is exactly the memory a student is trying to attach a name to. Every
  // query below is readable by any course member under RLS — the gate on the
  // check-in page was a product decision, not a permission.
  let seats: CourseSeat[] = [];
  let lastSession: { date: string; occupants: LastSessionOccupant[] } | null =
    null;
  {
    const schedule: CourseSchedule | null = isScheduleComplete({
      days: course.meeting_days,
      start: course.meeting_start,
      end: course.meeting_end,
      timezone: course.timezone,
    })
      ? {
          days: course.meeting_days as number[],
          start: course.meeting_start as string,
          end: course.meeting_end as string,
          timezone: course.timezone as string,
          termStart: course.term_start,
          termEnd: course.term_end,
        }
      : null;
    const now = new Date();
    const today = schedule
      ? sessionDateFor(schedule, now)
      : now.toISOString().slice(0, 10);

    const { data: priorSessions } = await supabase
      .from("class_sessions")
      .select("id, session_date")
      .eq("course_id", courseId)
      .lt("session_date", today)
      .order("session_date", { ascending: false })
      .limit(8);

    for (const prior of priorSessions ?? []) {
      const { data: rows } = await supabase
        .from("check_ins")
        .select("enrollment_id, seat_id")
        .eq("session_id", prior.id);
      // A cancelled or unopened day would render as an empty room and read
      // as a class nobody came to, so keep looking back.
      if ((rows ?? []).length === 0) continue;
      const directory = isConfigured.supabaseAdmin
        ? await getCourseDirectory(createAdminClient(), courseId)
        : {};
      lastSession = {
        date: prior.session_date,
        occupants: (rows ?? []).map((r) => ({
          seatId: r.seat_id,
          name: directory[r.enrollment_id]?.name ?? null,
          firstName: directory[r.enrollment_id]?.firstName ?? null,
          photoUrl: directory[r.enrollment_id]?.photoUrl ?? null,
          enrollmentId: r.enrollment_id,
        })),
      };
      break;
    }
    if (lastSession) {
      seats = await loadCourseSeats(supabase, courseId, course.room_id);
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Name games</h1>
        <p className="text-sm text-muted-foreground">
          {course.name} — learn the room before class starts.
        </p>
      </div>
      <NameGames
        players={players}
        roster={roster}
        rosterAvailable={isConfigured.supabaseAdmin}
        courseId={courseId}
        minPlayers={MIN_PLAYERS}
        seats={seats}
        lastSession={lastSession}
      />
    </div>
  );
}
