"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookmarkPlus, Download, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { rubricSignature, weightPercents, MAX_CRITERIA } from "@/lib/rubric";
import {
  deleteSavedRubric,
  draftRubricFromTaste,
  regradeAssignment,
  saveRubric,
  saveRubricToLibrary,
} from "@/server/actions/rubric";
import { advanceAnalysis } from "@/server/actions/grading";
import type { SavedCriterion, ThemeProvenance } from "@/types/db";

/**
 * The rubric as a grid under the taste file — the professor's at any point.
 *
 * Open: drafted from their taste file automatically until they edit it by
 * hand; "Rebuild from taste file" redrafts on request. Graded: edit, then
 * "Save & regrade" — weight-only changes re-rank on the spot, changed
 * wording sends every submission back through the AI. Either way the
 * professor's manual order is replaced by the new ranking, which is why a
 * regrade over a dragged or published list asks first.
 */

export interface GridCriterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  provenance: ThemeProvenance;
  /** Class quotes evidencing it (emerged themes only). */
  quotes: number;
}

interface Row {
  key: string;
  id?: string;
  name: string;
  description: string;
  /** Kept as typed so a half-entered number doesn't snap back. */
  weight: string;
  provenance: ThemeProvenance;
  quotes: number;
}

interface Props {
  assignmentId: string;
  title: string;
  /** "instructor": the grid IS the rubric; "cocreated": it seeds the class's. */
  tasteSource: "instructor" | "cocreated";
  criteria: GridCriterion[];
  savedRubrics: Array<{ id: string; name: string; criteria: SavedCriterion[] }>;
  /** open = draft/edit before grading; graded = edit + regrade; busy = the
   *  AI is mid-pipeline and the grid is read-only. */
  phase: "open" | "graded" | "busy";
  /** The professor has a taste file to draft from. */
  hasTaste: boolean;
  /** Set when the taste file changed since the last draft and the grid is
   *  untouched: that taste file's fingerprint, so each new version drafts
   *  exactly once. Null = nothing to draft. */
  autoDraftFrom: string | null;
  /** What the current scores were read against, to tell a weight tweak (no
   *  AI) from a wording change (AI re-reads everyone). */
  scoredSignature: string | null;
  /** How many submissions an AI regrade would re-read. */
  scoredCount: number;
  /** The professor already owns an order (dragged or past peer review). */
  ownsOrder: boolean;
  published: boolean;
  /** A regrade in flight: how far along it is. */
  regrade: { done: number; total: number } | null;
  /** Set when 0051 isn't applied: the grid can't be saved yet. */
  schemaProblem: string | null;
}

let rowCounter = 0;
const newKey = () => `row-${++rowCounter}`;

function toRows(
  criteria: Array<{
    id?: string;
    name: string;
    description: string;
    weight: number;
    provenance?: ThemeProvenance;
    quotes?: number;
  }>
): Row[] {
  return criteria.map((c) => ({
    key: c.id ?? newKey(),
    id: c.id,
    name: c.name,
    description: c.description,
    weight: String(c.weight),
    provenance: c.provenance ?? "professor",
    quotes: c.quotes ?? 0,
  }));
}

function payload(rows: Row[]) {
  return rows.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    name: r.name,
    description: r.description,
    weight: r.weight.trim() === "" ? NaN : Number(r.weight),
  }));
}

const PROVENANCE_LABEL: Record<ThemeProvenance, string | null> = {
  professor: null,
  class: "From the class",
  both: "Yours + the class",
};

export function RubricGrid(props: Props) {
  const {
    assignmentId,
    title,
    tasteSource,
    criteria,
    savedRubrics,
    phase,
    hasTaste,
    autoDraftFrom,
    scoredSignature,
    scoredCount,
    ownsOrder,
    published,
    regrade,
    schemaProblem,
  } = props;
  const router = useRouter();
  const initialRows = useMemo(() => toRows(criteria), [criteria]);
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [busy, setBusy] = useState<null | "save" | "draft" | "regrade">(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "save" | "rerun" | "rebuild">(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryName, setLibraryName] = useState(title);
  const [progress, setProgress] = useState(regrade);

  const readOnly = phase === "busy" || regrade !== null || !!schemaProblem;
  const dirty = JSON.stringify(payload(rows)) !== JSON.stringify(payload(initialRows));
  const shares = weightPercents(rows.map((r) => Math.max(0, Number(r.weight) || 0)));
  // The AI is needed when the wording changed, or when any criterion is new:
  // a new row has no scores, even if its words match one it replaced (an
  // imported copy of the same rubric, say). The server decides the same way.
  const filled = rows.filter((r) => r.name.trim() || r.description.trim());
  const needsAi =
    scoredSignature === null ||
    filled.some((r) => !r.id) ||
    rubricSignature(filled) !== scoredSignature;

  // Taste file → grid, on its own, while the grid is still the AI's draft —
  // once per version of the taste file, and never over unsaved edits. A
  // failure (no AI key, say) is shown inline: a toast would repeat on every
  // visit until it's fixed.
  const draftedFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!autoDraftFrom || draftedFrom.current === autoDraftFrom || schemaProblem || dirty) {
      return;
    }
    draftedFrom.current = autoDraftFrom;
    setDrafting(true);
    setDraftError(null);
    void draftRubricFromTaste(assignmentId)
      .then((result) => {
        if (!result.ok) setDraftError(result.error);
        else if (result.data?.drafted) router.refresh();
      })
      .finally(() => setDrafting(false));
  }, [assignmentId, autoDraftFrom, router, schemaProblem, dirty]);

  // A regrade is driven by the server tick; nudging from here just makes it
  // land sooner while the professor watches. Refresh once, when it's done —
  // not per submission, so an open cockpit doesn't hammer the server.
  useEffect(() => {
    if (!regrade) return;
    let cancelled = false;
    async function nudge() {
      while (!cancelled) {
        const result = await advanceAnalysis(assignmentId).catch(() => null);
        if (cancelled) break;
        if (result?.ok && result.data) {
          if (result.data.phase !== "regrade") {
            router.refresh();
            break;
          }
          if (result.data.total >= 0) {
            setProgress({ done: result.data.scored, total: result.data.total });
          }
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    void nudge();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, regrade, router]);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: newKey(), name: "", description: "", weight: "10", provenance: "professor", quotes: 0 },
    ]);
  }

  function importRubric(saved: { name: string; criteria: SavedCriterion[] }) {
    // New rows, not linked to the saved copy: editing either never touches
    // the other. Nothing is stored until Save.
    setRows(toRows(saved.criteria.map((c) => ({ ...c, id: undefined }))));
    toast.success(`Imported "${saved.name}" — review it, then save.`);
  }

  function afterRegrade(applied: string | undefined) {
    if (applied === "ai") {
      toast.success(
        `Regrading ${scoredCount} submission${scoredCount === 1 ? "" : "s"} against the new rubric — the list rebuilds when it's done.`
      );
    } else if (applied === "weights") {
      toast.success("Re-ranked with the new weights.");
    } else {
      toast.success("Rubric saved.");
    }
    router.refresh();
  }

  async function save() {
    setConfirm(null);
    setBusy("save");
    const result = await saveRubric(assignmentId, payload(rows), {
      regrade: phase === "graded",
    });
    setBusy(null);
    if (!result.ok) return void toast.error(result.error);
    afterRegrade(result.data?.applied);
  }

  async function rerun() {
    setConfirm(null);
    setBusy("regrade");
    const result = await regradeAssignment(assignmentId);
    setBusy(null);
    if (!result.ok) return void toast.error(result.error);
    afterRegrade(result.data?.applied);
  }

  async function rebuild() {
    setConfirm(null);
    setBusy("draft");
    const result = await draftRubricFromTaste(assignmentId, { force: true });
    setBusy(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Redrafted from your taste file.");
    router.refresh();
  }

  async function saveToLibrary() {
    const result = await saveRubricToLibrary(libraryName, payload(rows));
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Saved to My rubrics as "${libraryName.trim()}".`);
    setLibraryOpen(false);
    router.refresh();
  }

  async function removeSaved(id: string, name: string) {
    const result = await deleteSavedRubric(id);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Removed "${name}" from My rubrics.`);
    router.refresh();
  }

  // A regrade replaces the professor's order (and takes published grades
  // down) and an AI pass spends their credits — ask first whenever there's
  // something to lose. A weights-only re-rank of a draft just happens.
  const regradeWarns =
    phase === "graded" && (ownsOrder || published || (needsAi && scoredCount > 0));
  function requestSave() {
    if (regradeWarns) setConfirm("save");
    else void save();
  }

  const subtitle =
    phase === "graded"
      ? "Edit, then regrade. Weights decide the ranking: each student's score is the weighted average of their criterion scores."
      : tasteSource === "instructor"
        ? "What the AI grades against. Drafted from your taste file — edit anything, or import one of your saved rubrics."
        : "Your criteria. At the deadline the class's own themes join these; yours stay word for word.";

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="font-semibold">Rubric</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={readOnly}>
                  <Download className="size-4" />
                  Import
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>My rubrics</DropdownMenuLabel>
                {savedRubrics.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                    None saved yet.
                  </p>
                ) : (
                  savedRubrics.map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => importRubric(s)}>
                      {s.name}
                      <span className="ml-auto pl-3 text-xs text-muted-foreground">
                        {s.criteria.length}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length === 0 || !!schemaProblem}
              onClick={() => {
                setLibraryName(title);
                setLibraryOpen(true);
              }}
            >
              <BookmarkPlus className="size-4" />
              Save to My rubrics
            </Button>
          </div>
        </div>

        {schemaProblem && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            {schemaProblem}
          </p>
        )}
        {drafting && (
          <p className="text-sm text-muted-foreground">
            Turning your taste file into a rubric…
          </p>
        )}
        {draftError && !drafting && (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t draft the rubric from your taste file: {draftError}
          </p>
        )}
        {phase === "busy" && (
          <p className="text-sm text-muted-foreground">
            The AI is grading against this rubric right now — edit it once the
            ranked list is up.
          </p>
        )}
        {regrade && (
          <p className="rounded-md border border-primary/50 bg-primary/5 p-3 text-sm">
            <span className="font-medium">
              Regrading — {progress?.done ?? regrade.done} of{" "}
              {progress?.total ?? regrade.total} re-read.
            </span>{" "}
            <span className="text-muted-foreground">
              The list rebuilds from the new scores when it finishes; reordering
              and publishing wait until then. You don&apos;t need to keep this
              page open.
            </span>
          </p>
        )}

        {rows.length === 0 && !drafting ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {hasTaste
              ? "No rubric yet. Add criteria, import a saved rubric, or rebuild it from your taste file."
              : tasteSource === "instructor"
                ? "No rubric yet. Write your taste file above and it becomes a grid here — or add criteria yourself."
                : "No criteria of your own. The class's themes will form the rubric at the deadline — or add yours to seed it."}
          </p>
        ) : (
          <div className="grid gap-2">
            <div className="hidden gap-2 px-1 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(9rem,13rem)_1fr_7.5rem_2rem]">
              <span>Criterion</span>
              <span>What excellent looks like</span>
              <span>Weight</span>
              <span />
            </div>
            {rows.map((row, i) => (
              <div
                key={row.key}
                className="grid gap-2 rounded-lg border p-2 md:grid-cols-[minmax(9rem,13rem)_1fr_7.5rem_2rem] md:items-start"
              >
                <div className="grid gap-1">
                  <Input
                    aria-label={`Criterion ${i + 1} name`}
                    value={row.name}
                    onChange={(e) => update(row.key, { name: e.target.value })}
                    disabled={readOnly}
                    maxLength={80}
                    placeholder="e.g. Evidence"
                  />
                  {(PROVENANCE_LABEL[row.provenance] || row.quotes > 0) && (
                    <span className="px-1 text-xs text-muted-foreground">
                      {PROVENANCE_LABEL[row.provenance]}
                      {row.quotes > 0
                        ? `${PROVENANCE_LABEL[row.provenance] ? " · " : ""}${row.quotes} class quote${row.quotes === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  )}
                </div>
                <textarea
                  aria-label={`Criterion ${i + 1} description`}
                  value={row.description}
                  onChange={(e) => update(row.key, { description: e.target.value })}
                  disabled={readOnly}
                  rows={2}
                  maxLength={600}
                  placeholder="What does excellent work look like on this?"
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Criterion ${i + 1} weight`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={row.weight}
                    onChange={(e) => update(row.key, { weight: e.target.value })}
                    disabled={readOnly}
                    className="w-16"
                  />
                  <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">
                    {shares[i]}%
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove criterion ${i + 1}`}
                  disabled={readOnly}
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={addRow}
            disabled={readOnly || rows.length >= MAX_CRITERIA}
          >
            <Plus className="size-4" />
            Add criterion
          </Button>
          {phase === "open" && hasTaste && (
            <Button
              variant="outline"
              size="sm"
              disabled={readOnly || busy !== null || drafting}
              onClick={() => (rows.length > 0 ? setConfirm("rebuild") : void rebuild())}
            >
              {busy === "draft" ? "Redrafting…" : "Rebuild from taste file"}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {phase === "graded" && !dirty && (
              <Button
                variant="outline"
                size="sm"
                disabled={readOnly || busy !== null || scoredCount === 0}
                onClick={() => setConfirm("rerun")}
              >
                {busy === "regrade" ? "Starting…" : "Re-run AI grading"}
              </Button>
            )}
            {dirty && (
              <Button variant="ghost" size="sm" onClick={() => setRows(initialRows)} disabled={busy !== null}>
                Discard changes
              </Button>
            )}
            <Button size="sm" disabled={readOnly || !dirty || busy !== null} onClick={requestSave}>
              {busy === "save"
                ? "Saving…"
                : phase === "graded"
                  ? needsAi && scoredCount > 0
                    ? `Save & regrade ${scoredCount}`
                    : "Save & re-rank"
                  : "Save rubric"}
            </Button>
          </div>
        </div>
        {phase === "graded" && dirty && (
          <p className="text-xs text-muted-foreground">
            {needsAi && scoredCount > 0
              ? "You changed what the criteria say, so the AI re-reads every submission (on your AI credits)."
              : "Only weights changed — the ranking is recomputed instantly, no AI needed."}
          </p>
        )}
      </CardContent>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "rebuild" ? "Replace the grid?" : "Regrade this assignment?"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "rebuild"
                ? "The grid is redrafted from your taste file. Your edits to it are replaced."
                : [
                    (confirm === "rerun" || needsAi) &&
                      `The AI re-reads all ${scoredCount} submission${scoredCount === 1 ? "" : "s"} against the rubric, on your AI credits.`,
                    ownsOrder &&
                      "The ranked list is rebuilt from the new scores — your manual reordering is replaced. Grade lines stay where they are.",
                    published &&
                      "Grades are published: they come down until you publish again, so students never see a half-regraded class.",
                  ]
                    .filter(Boolean)
                    .join(" ")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                void (confirm === "rebuild" ? rebuild() : confirm === "rerun" ? rerun() : save())
              }
            >
              {confirm === "rebuild" ? "Replace" : "Regrade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save to My rubrics</DialogTitle>
            <DialogDescription>
              A copy you can import into any assignment in any of your courses.
              Saving under a name you already use replaces that one.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="rubric-library-name">Name</Label>
            <Input
              id="rubric-library-name"
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              maxLength={120}
            />
          </div>
          {savedRubrics.length > 0 && (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">Already saved</p>
              <ul className="grid max-h-40 gap-1 overflow-y-auto">
                {savedRubrics.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      className="truncate text-left hover:underline"
                      onClick={() => setLibraryName(s.name)}
                    >
                      {s.name}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {s.criteria.length} criteria
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => void removeSaved(s.id, s.name)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLibraryOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveToLibrary()} disabled={!libraryName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
