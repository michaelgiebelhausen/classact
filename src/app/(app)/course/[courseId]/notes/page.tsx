import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import {
  getSignedDeckDownloadUrl,
  getSignedMaterialDownloadUrl,
} from "@/lib/storage";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  NotesArchive,
  type ArchiveLecture,
} from "@/components/features/notes/NotesArchive";

export default async function NotesPage({
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
    .select("id, name, transcripts_downloadable")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  // The address they sign in with is the one they'll reach for first; the
  // dialog lets them change it to an agent's inbox or anywhere else.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: myEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();

  // No enrollment means the viewer is the professor, or someone not yet on the
  // roster. Either way there is nothing here for them, and saying why matters:
  // a student who believes the professor reads their notes writes different
  // notes, and the professor should be able to tell them so plainly.
  if (!myEnrollment) {
    return (
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Notes</h1>
          <p className="text-muted-foreground">{course.name}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>These notes are private to each student</CardTitle>
            <CardDescription>
              Every student&apos;s lecture notes are saved to their own account.
              Nobody else can read them — not classmates, and not you as the
              professor. Students can export their own notes as a Markdown file
              or email them to themselves at any time.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { data: entries } = await supabase
    .from("lecture_note_entries")
    .select("id, lecture_id, page, content, created_at")
    .eq("enrollment_id", myEnrollment.id)
    .order("created_at", { ascending: true });

  const { data: lectures } = await supabase
    .from("lectures")
    .select("id, deck_id, started_at")
    .eq("course_id", courseId);

  const { data: decks } = await supabase
    .from("lecture_decks")
    .select("id, title, kind, storage_path, transcript_path, transcript_title")
    .eq("course_id", courseId);
  const deckById = new Map((decks ?? []).map((d) => [d.id, d]));

  // Signed download links for the slide PDFs, so notes and the deck they were
  // taken against can leave together. One URL per deck, not per lecture.
  // Signed in parallel (and served from the 45-min URL cache after the first
  // render): this was one awaited storage call per deck, in series.
  const slidesUrlByDeck = new Map<string, string | null>(
    await Promise.all(
      Array.from(deckById.values())
        .filter((deck) => deck.kind === "pdf" && deck.storage_path)
        .map(async (deck) =>
          [
            deck.id,
            await getSignedDeckDownloadUrl(
              supabase,
              deck.storage_path!,
              `${deck.title || "slides"}.pdf`
            ),
          ] as const
        )
    )
  );

  // Transcript links come from the admin client — the course-materials
  // bucket has no member-read policy, so the professor's download toggle is
  // enforced right here by simply not minting when it's off.
  const transcriptUrlByDeck = new Map<string, string | null>();
  if (course.transcripts_downloadable && isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const signed = await Promise.all(
      Array.from(deckById.values())
        .filter((deck) => deck.transcript_path)
        .map(async (deck) => {
          const ext = deck.transcript_path!.split(".").pop() ?? "txt";
          return [
            deck.id,
            await getSignedMaterialDownloadUrl(
              admin,
              deck.transcript_path!,
              `${deck.transcript_title || "transcript"}.${ext}`
            ),
          ] as const;
        })
    );
    for (const [id, url] of signed) transcriptUrlByDeck.set(id, url);
  }

  const lectureById = new Map(
    (lectures ?? []).map((l) => [
      l.id,
      {
        startedAt: l.started_at,
        deckTitle: deckById.get(l.deck_id)?.title ?? "",
        slidesUrl: slidesUrlByDeck.get(l.deck_id) ?? null,
        transcriptTitle: deckById.get(l.deck_id)?.transcript_title ?? null,
        transcriptUrl: transcriptUrlByDeck.get(l.deck_id) ?? null,
      },
    ])
  );

  // Group by lecture, newest lecture first — the one they just sat through is
  // the one they want. Entries stay chronological inside it.
  const grouped = new Map<string, ArchiveLecture>();
  for (const entry of entries ?? []) {
    const meta = lectureById.get(entry.lecture_id);
    if (!meta) continue;
    const bucket = grouped.get(entry.lecture_id) ?? {
      lectureId: entry.lecture_id,
      startedAt: meta.startedAt,
      deckTitle: meta.deckTitle,
      slidesUrl: meta.slidesUrl,
      transcriptTitle: meta.transcriptTitle,
      transcriptUrl: meta.transcriptUrl,
      entries: [],
    };
    bucket.entries.push({
      id: entry.id,
      page: entry.page,
      content: entry.content,
      createdAt: entry.created_at,
    });
    grouped.set(entry.lecture_id, bucket);
  }
  const archive = [...grouped.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notes</h1>
        <p className="text-muted-foreground">{course.name}</p>
      </div>
      <NotesArchive
        courseId={courseId}
        courseName={course.name}
        viewerEmail={user?.email ?? profile.school_email ?? ""}
        lectures={archive}
      />
    </div>
  );
}
