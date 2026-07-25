import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { getSignedPhotoUrls } from "@/lib/storage";
import { PhotoUploader } from "@/components/features/profile/PhotoUploader";
import { DeleteDataButton } from "@/components/features/profile/DeleteDataButton";
import { AboutMeForm } from "@/components/features/profile/AboutMeForm";
import { LinkedInForm } from "@/components/features/profile/LinkedInForm";
import { icebreakersByKey, DEFAULT_ICEBREAKER_KEYS } from "@/lib/icebreakers";
import type { PhotoKind } from "@/types/db";

export default async function ProfilePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: photos } = await supabase
    .from("profile_photos")
    .select("kind, storage_path")
    .eq("profile_id", profile.id);

  const urlMap = await getSignedPhotoUrls(
    supabase,
    (photos ?? []).map((p) => p.storage_path)
  );
  const photoUrls: Partial<Record<PhotoKind, string>> = {};
  for (const p of photos ?? []) {
    const url = urlMap[p.storage_path];
    if (url) photoUrls[p.kind as PhotoKind] = url;
  }

  // Professors answer icebreakers on their profile (they have no enrollment
  // to hang per-course answers on) — the questions are the union of what
  // they ask across their own courses.
  const isProfessor = profile.role === "professor";
  let aboutFields: ReturnType<typeof icebreakersByKey> = [];
  let aboutAnswers: Record<string, string> = {};
  if (isProfessor) {
    const [{ data: myCourses }, { data: myAnswers }] = await Promise.all([
      supabase.from("courses").select("icebreaker_fields").eq("professor_id", profile.id),
      supabase
        .from("profile_answers")
        .select("field_key, value")
        .eq("profile_id", profile.id),
    ]);
    const keys = new Set<string>();
    for (const c of myCourses ?? []) {
      for (const k of (c.icebreaker_fields as string[]) ?? []) keys.add(k);
    }
    if (keys.size === 0) for (const k of DEFAULT_ICEBREAKER_KEYS) keys.add(k);
    aboutFields = icebreakersByKey([...keys]);
    aboutAnswers = Object.fromEntries(
      (myAnswers ?? []).map((a) => [a.field_key, a.value])
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">
          {profile.full_name ?? "No name set"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My photos</CardTitle>
          <CardDescription>
            {isProfessor
              ? "Add a few and your students will learn your face in the name games too — the games rotate through whichever ones you upload."
              : "These are what classmates see in the name games."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <PhotoUploader kind="candid" initialUrl={photoUrls.candid ?? null} />
          <PhotoUploader
            kind="professional"
            initialUrl={photoUrls.professional ?? null}
          />
          <PhotoUploader
            kind="adventure"
            initialUrl={photoUrls.adventure ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>LinkedIn</CardTitle>
          <CardDescription>
            The people in this room are your first professional network.
            Add your profile and coursemates can connect with you — it shows
            beside your name in the name games.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LinkedInForm initial={profile.linkedin_url} />
        </CardContent>
      </Card>

      {isProfessor && aboutFields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>About me</CardTitle>
            <CardDescription>
              The same icebreakers you ask your classes. Your answers show on
              the back of your flash card, so students learn something about
              you while they learn your name.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AboutMeForm fields={aboutFields} initial={aboutAnswers} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your data, your call</CardTitle>
          <CardDescription>
            You own your data. Nothing leaves this class unless you say so —
            and you can delete your photos and answers any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteDataButton />
        </CardContent>
      </Card>
    </div>
  );
}
