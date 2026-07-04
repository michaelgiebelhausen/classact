import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { getSignedPhotoUrls } from "@/lib/storage";
import { DEFAULT_ICEBREAKER_KEYS } from "@/lib/icebreakers";
import { OnboardingFlow } from "@/components/features/profile/OnboardingFlow";
import type { PhotoKind } from "@/types/db";

export default async function OnboardingPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "professor") redirect("/dashboard");

  const supabase = await createClient();

  // Union of icebreaker fields across the student's courses (usually one).
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, courses(icebreaker_fields)")
    .eq("profile_id", profile.id);

  const keySet = new Set<string>();
  for (const e of enrollments ?? []) {
    const course = e.courses as unknown as { icebreaker_fields: string[] } | null;
    for (const k of course?.icebreaker_fields ?? []) keySet.add(k);
  }
  const icebreakerKeys =
    keySet.size > 0 ? Array.from(keySet) : DEFAULT_ICEBREAKER_KEYS;

  // Existing photos + answers (resume support).
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

  const enrollmentIds = (enrollments ?? []).map((e) => e.id);
  const initialAnswers: Record<string, string> = {};
  if (enrollmentIds.length > 0) {
    const { data: answers } = await supabase
      .from("student_answers")
      .select("field_key, value")
      .in("enrollment_id", enrollmentIds);
    for (const a of answers ?? []) initialAnswers[a.field_key] = a.value;
  }

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Welcome to ClassAct
      </h1>
      <OnboardingFlow
        initialName={profile.full_name ?? ""}
        initialPhonetic={profile.name_phonetic ?? ""}
        photoUrls={photoUrls}
        icebreakerKeys={icebreakerKeys}
        initialAnswers={initialAnswers}
      />
    </div>
  );
}
