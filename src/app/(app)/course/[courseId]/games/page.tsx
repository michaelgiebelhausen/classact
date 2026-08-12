import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { getSignedPhotoUrls, resolveEnrollmentPhotos } from "@/lib/storage";
import { flashcardHintFields } from "@/lib/icebreakers";
import {
  NameGames,
  type GamePlayer,
  type RosterPerson,
} from "@/components/features/games/NameGames";

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
    .select("id, name, icebreaker_fields, professor_id")
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
    const photoMap = await resolveEnrollmentPhotos(admin, candidates);

    // Pronunciation guides + LinkedIn, keyed by profile (activated students).
    const phoneticByProfile = new Map<string, string>();
    const linkedinByProfile = new Map<string, string>();
    const activatedIds = candidates
      .map((e) => e.profile_id)
      .filter((id): id is string => Boolean(id));
    if (activatedIds.length > 0) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, name_phonetic, linkedin_url")
        .in("id", activatedIds);
      for (const p of profs ?? []) {
        if (p.name_phonetic) phoneticByProfile.set(p.id, p.name_phonetic);
        if (p.linkedin_url) linkedinByProfile.set(p.id, p.linkedin_url);
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
            .select("storage_path")
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
      // Only with a real name: professors who signed up with a password
      // never set full_name, and a card reading "Your professor" would file
      // under a fabricated surname with fabricated initials.
      if (prof?.full_name?.trim()) {
        roster.push({
          enrollmentId: `professor:${course.professor_id}`,
          name: prof.full_name,
          photoUrl: urls[0] ?? null,
          phonetic: prof.name_phonetic ?? null,
        });
      }
      if (urls.length > 0) {
        const answerByKey = new Map(
          (profAnswers ?? []).map((a) => [a.field_key, a.value])
        );
        const facts: Array<{ label: string; value: string }> = [];
        for (const f of hintFields) {
          const value = answerByKey.get(f.key);
          if (value) facts.push({ label: f.label, value });
        }
        players.push({
          enrollmentId: `professor:${course.professor_id}`,
          name: prof?.full_name ?? "Your professor",
          photoUrls: urls,
          phonetic: prof?.name_phonetic ?? null,
          hints: facts,
          linkedinUrl: prof?.linkedin_url ?? null,
        });
      }
    }

    for (const e of candidates) {
      const urls = photoMap.get(e.id) ?? [];
      const phonetic =
        (e.profile_id ? phoneticByProfile.get(e.profile_id) : null) ??
        e.roster_name_phonetic ??
        null;
      roster.push({
        enrollmentId: e.id,
        name: e.roster_name,
        photoUrl: urls[0] ?? null,
        phonetic,
      });
      if (urls.length > 0) {
        players.push({
          enrollmentId: e.id,
          name: e.roster_name,
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
      />
    </div>
  );
}
