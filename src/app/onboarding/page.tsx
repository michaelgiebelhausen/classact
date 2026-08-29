import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { getSignedPhotoUrls } from "@/lib/storage";
import { DEFAULT_ICEBREAKER_KEYS } from "@/lib/icebreakers";
import { splitForEditing } from "@/lib/names";
import { OnboardingFlow } from "@/components/features/profile/OnboardingFlow";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { PhotoKind } from "@/types/db";

export default async function OnboardingPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  // Union of icebreaker fields across the classes this person is in (usually
  // one). Dropped rows are excluded — a class you left shouldn't be setting
  // the questions you answer.
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, roster_name_phonetic, courses(icebreaker_fields)")
    .eq("profile_id", profile.id)
    .neq("status", "dropped");

  // Onboarding is something you do for a class, so there has to be one. This
  // used to read `role === "professor"`, which sent the wrong people away and
  // kept the wrong people here: a mis-flagged student was bounced to a
  // dashboard they had no business on, and a professor attending a colleague's
  // class was excused from the onboarding that class is owed. Belonging to no
  // class at all now means the dashboard's chooser, not a form about nothing.
  if (!enrollments || enrollments.length === 0) redirect("/dashboard");

  // AI-generated pronunciation default (from roster import/sync) to pre-fill the
  // field; the student's own saved value, if any, takes precedence below.
  const autoPhonetic =
    (enrollments ?? [])
      .map((e) => e.roster_name_phonetic)
      .find((v): v is string => Boolean(v)) ?? "";

  const keySet = new Set<string>();
  for (const e of enrollments ?? []) {
    const course = e.courses as unknown as { icebreaker_fields: string[] } | null;
    for (const k of course?.icebreaker_fields ?? []) keySet.add(k);
  }
  const icebreakerKeys =
    keySet.size > 0 ? Array.from(keySet) : DEFAULT_ICEBREAKER_KEYS;

  // Prefer saved parts; otherwise split the composed name to pre-fill both
  // fields (a returning student who onboarded before parts existed).
  const hasNameParts =
    Boolean(profile.first_name?.trim()) || Boolean(profile.last_name?.trim());
  const { first: initialFirst, last: initialLast } = hasNameParts
    ? { first: profile.first_name ?? "", last: profile.last_name ?? "" }
    : splitForEditing(profile.full_name ?? "");

  // Same for pronunciation (0043): saved parts win; else split the composed
  // value, falling back to the roster-derived whole-name guess.
  const hasPhoneticParts =
    Boolean(profile.first_name_phonetic?.trim()) ||
    Boolean(profile.last_name_phonetic?.trim());
  const { first: initialFirstPhonetic, last: initialLastPhonetic } =
    hasPhoneticParts
      ? {
          first: profile.first_name_phonetic ?? "",
          last: profile.last_name_phonetic ?? "",
        }
      : splitForEditing(profile.name_phonetic || autoPhonetic);
  // The pre-fill is a guess only when it came from the roster/AI autoPhonetic,
  // not from anything the student saved themselves.
  const phoneticWasGuessed =
    !hasPhoneticParts &&
    !(profile.name_phonetic ?? "").trim() &&
    autoPhonetic.trim().length > 0;

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
        initialFirst={initialFirst}
        initialLast={initialLast}
        initialFirstPhonetic={initialFirstPhonetic}
        initialLastPhonetic={initialLastPhonetic}
        phoneticWasGuessed={phoneticWasGuessed}
        photoUrls={photoUrls}
        icebreakerKeys={icebreakerKeys}
        initialAnswers={initialAnswers}
      />
      {/* Teaching is a thing you can also do, not a different kind of
          account to switch to — so this is a link to the course builder, and
          the class they're onboarding for stays theirs either way. */}
      <div className="mt-8 grid justify-items-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">
          Also teaching a course of your own?
        </p>
        <Button asChild variant="outline">
          <Link href="/course/new">Set up a course too</Link>
        </Button>
      </div>
    </div>
  );
}
