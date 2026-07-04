import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { getSignedPhotoUrls } from "@/lib/storage";
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
      .select("id, roster_name, profile_id")
      .eq("course_id", courseId)
      .eq("status", "active");

    const candidates = (enrollments ?? []).filter(
      (e) => e.profile_id && e.profile_id !== profile.id
    );
    const memberIds = candidates.map((e) => e.profile_id as string);
    const { data: photos } =
      memberIds.length > 0
        ? await admin
            .from("profile_photos")
            .select("profile_id, storage_path")
            .in("profile_id", memberIds)
        : { data: [] as { profile_id: string; storage_path: string }[] };

    const urlMap = await getSignedPhotoUrls(
      admin,
      (photos ?? []).map((p) => p.storage_path)
    );
    const photosByProfile = new Map<string, string[]>();
    for (const p of photos ?? []) {
      const url = urlMap[p.storage_path];
      if (!url) continue;
      const list = photosByProfile.get(p.profile_id) ?? [];
      list.push(url);
      photosByProfile.set(p.profile_id, list);
    }

    for (const e of candidates) {
      const urls = photosByProfile.get(e.profile_id as string) ?? [];
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
