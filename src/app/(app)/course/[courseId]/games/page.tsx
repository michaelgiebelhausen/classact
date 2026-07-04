import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { resolveEnrollmentPhotos } from "@/lib/storage";
import { flashcardHintFields } from "@/lib/icebreakers";
import { NameGames, type GamePlayer } from "@/components/features/games/NameGames";

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
    .select("id, name, icebreaker_fields")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  // Build the player pool (classmates with >=1 photo, excluding yourself).
  const players: GamePlayer[] = [];
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

    // Phonetic pronunciation guides, keyed by profile (activated students only).
    const phoneticByProfile = new Map<string, string>();
    const activatedIds = candidates
      .map((e) => e.profile_id)
      .filter((id): id is string => Boolean(id));
    if (activatedIds.length > 0) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, name_phonetic")
        .in("id", activatedIds);
      for (const p of profs ?? []) {
        if (p.name_phonetic) phoneticByProfile.set(p.id, p.name_phonetic);
      }
    }

    // One icebreaker fact per classmate for the flash-card back — the first
    // flashcard-eligible field (in catalog priority order) they actually answered.
    const hintByEnrollment = new Map<string, { label: string; value: string }>();
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
        for (const f of hintFields) {
          const value = m.get(f.key);
          if (value) {
            hintByEnrollment.set(enrollmentId, { label: f.label, value });
            break;
          }
        }
      }
    }

    for (const e of candidates) {
      const urls = photoMap.get(e.id) ?? [];
      if (urls.length > 0) {
        players.push({
          enrollmentId: e.id,
          name: e.roster_name,
          photoUrls: urls,
          phonetic:
            (e.profile_id ? phoneticByProfile.get(e.profile_id) : null) ??
            e.roster_name_phonetic ??
            null,
          hint: hintByEnrollment.get(e.id) ?? null,
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
      <NameGames players={players} courseId={courseId} minPlayers={MIN_PLAYERS} />
    </div>
  );
}
