import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { resolveEnrollmentPhotos } from "@/lib/storage";
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
    .select("id, name")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  // Build the player pool (classmates with >=1 photo, excluding yourself).
  const players: GamePlayer[] = [];
  if (isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data: enrollments } = await admin
      .from("enrollments")
      .select("id, roster_name, profile_id, roster_photo_path")
      .eq("course_id", courseId);

    // Everyone but yourself; not-yet-activated students (null profile_id) are
    // included so their Canvas photo can seed the game.
    const candidates = (enrollments ?? []).filter(
      (e) => e.profile_id !== profile.id
    );
    const photoMap = await resolveEnrollmentPhotos(admin, candidates);

    for (const e of candidates) {
      const urls = photoMap.get(e.id) ?? [];
      if (urls.length > 0) {
        players.push({
          enrollmentId: e.id,
          name: e.roster_name,
          photoUrls: urls,
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
