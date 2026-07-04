import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { getSignedDeckUrl } from "@/lib/storage";
import { StageView } from "@/components/features/follow/StageView";

/**
 * Projector view — lives outside the (app) route group on purpose so it
 * renders with zero chrome: no sidebar, no topbar, just the slide.
 */
export default async function StagePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  // RLS membership gate — non-members get null.
  const { data: course } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const { data: lecture } = await supabase
    .from("lectures")
    .select("id, deck_id, current_page")
    .eq("course_id", courseId)
    .is("ended_at", null)
    .maybeSingle();

  if (!lecture) {
    return (
      <div className="grid h-screen place-items-center bg-black text-white/70">
        <div className="text-center">
          <p className="text-2xl font-semibold">No live lecture</p>
          <p className="mt-2 text-sm">
            Start presenting from Follow Along, then open this window.
          </p>
        </div>
      </div>
    );
  }

  const { data: deck } = await supabase
    .from("lecture_decks")
    .select("id, title, kind, storage_path, embed_url, page_count")
    .eq("id", lecture.deck_id)
    .single();
  if (!deck) notFound();

  const fileUrl =
    deck.kind === "pdf" && deck.storage_path
      ? await getSignedDeckUrl(supabase, deck.storage_path)
      : null;

  return (
    <StageView
      courseId={courseId}
      lectureId={lecture.id}
      initialPage={lecture.current_page}
      pageCount={deck.page_count}
      deckTitle={deck.title}
      deckKind={deck.kind}
      fileUrl={fileUrl}
      embedUrl={deck.embed_url}
    />
  );
}
