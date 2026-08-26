import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Remedy } from "@/lib/activation";
import {
  ROSTER_STAGE_ORDER,
  ROSTER_STAGE_META,
  type RosterStage,
} from "@/lib/rosterstage";
import { DepartureList } from "@/components/features/roster/DepartureList";
import { RosterSection } from "@/components/features/roster/RosterSection";
import { SyncCanvasButton } from "@/components/features/roster/SyncCanvasButton";

export interface StagedPerson {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
  /** Why they're in this section, when it isn't obvious from the section. */
  note?: string;
  /** What would actually help this person — the stuck section holds two
   *  different problems whose remedies are opposites. */
  remedy?: Remedy;
  /** Joined with the course code and still pending, so check-in refuses them. */
  pendingApproval?: boolean;
}

/**
 * The roster split by how far through registration each person is.
 *
 * Professor-only. The plain grid of faces stays for students: which of their
 * classmates hasn't claimed an account, and which signed in with a personal
 * address, is nobody else's business — and this page is one a professor may
 * well have projected.
 *
 * Empty sections are dropped rather than rendered empty. A class where
 * everyone is through should read as one short list, not four headings and
 * three apologies.
 */
export function StagedRoster({
  groups,
  total,
  courseId,
  canvasCourseId,
  sectionIds,
  syncedAt,
  joinCode,
}: {
  groups: Record<RosterStage, StagedPerson[]>;
  total: number;
  courseId: string;
  canvasCourseId: string | null;
  sectionIds: string[] | null;
  syncedAt: string | null;
  joinCode: string | null;
}) {
  const present = ROSTER_STAGE_ORDER.filter((s) => groups[s].length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who&apos;s in this class</CardTitle>
        <CardDescription>
          {total} {total === 1 ? "person" : "people"} on the roster, grouped by
          how far they&apos;ve got.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8">
        {present.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No students yet — import your roster from Canvas or CSV in Setup.
          </p>
        ) : (
          present.map((stage) => {
            const meta = ROSTER_STAGE_META[stage];
            const people = groups[stage];
            return (
              <section key={stage} className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{meta.title}</h3>
                  <Badge variant={meta.tone}>{people.length}</Badge>
                </div>
                <p className="max-w-prose text-xs text-muted-foreground">
                  {meta.blurb}
                </p>

                {/* The departures section is a worklist rather than a
                    gallery: it is the one section that asks the professor to
                    decide something. */}
                {stage === "no_longer_on_canvas" ? (
                  <DepartureList courseId={courseId} people={people} />
                ) : (
                  <RosterSection
                    stage={stage}
                    courseId={courseId}
                    joinCode={joinCode}
                    people={people}
                  />
                )}
              </section>
            );
          })
        )}

        <div className="border-t pt-4">
          <SyncCanvasButton
            courseId={courseId}
            canvasCourseId={canvasCourseId}
            sectionIds={sectionIds}
            syncedAt={syncedAt}
          />
        </div>
      </CardContent>
    </Card>
  );
}
