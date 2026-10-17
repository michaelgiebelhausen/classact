import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { rubricSignature } from "@/lib/rubric";

/**
 * The grid decides, before anything is sent, whether a save is arithmetic
 * (weights only — instant, free) or a full AI pass on the professor's
 * credits, and it says so on the button. That call is what these pin down,
 * along with what actually goes to the server.
 */

const saveRubric = vi.fn();
const draftRubricFromTaste = vi.fn();
vi.mock("@/server/actions/rubric", () => ({
  saveRubric: (...args: unknown[]) => saveRubric(...args),
  draftRubricFromTaste: (...args: unknown[]) => draftRubricFromTaste(...args),
  regradeAssignment: vi.fn(),
  saveRubricToLibrary: vi.fn(),
  deleteSavedRubric: vi.fn(),
}));
// A regrade still in flight: the nudge loop keeps the progress line live.
vi.mock("@/server/actions/grading", () => ({
  advanceAnalysis: vi.fn(() =>
    Promise.resolve({ ok: true, data: { phase: "regrade", state: "finalizing", scored: 3, total: 12 } })
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { RubricGrid } = await import("@/components/features/assignments/RubricGrid");

const criteria = [
  { id: "t1", name: "Evidence", description: "Claims backed by data", weight: 60, provenance: "professor" as const, quotes: 0 },
  { id: "t2", name: "Clarity", description: "Reads in one pass", weight: 40, provenance: "both" as const, quotes: 3 },
];

function setup(overrides: Partial<React.ComponentProps<typeof RubricGrid>> = {}) {
  render(
    <RubricGrid
      assignmentId="a1"
      title="Memo"
      tasteSource="instructor"
      criteria={criteria}
      savedRubrics={[]}
      phase="graded"
      hasTaste
      autoDraftFrom={null}
      scoredSignature={rubricSignature(criteria)}
      scoredCount={12}
      ownsOrder={false}
      published={false}
      regrade={null}
      schemaProblem={null}
      {...overrides}
    />
  );
}

beforeEach(() => {
  saveRubric.mockReset().mockResolvedValue({ ok: true, data: { applied: "weights" } });
  draftRubricFromTaste.mockReset().mockResolvedValue({ ok: true, data: { drafted: false } });
});

describe("RubricGrid", () => {
  test("shows each weight as its share of 100, and where a criterion came from", () => {
    setup();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("Yours + the class · 3 class quotes")).toBeTruthy();
  });

  test("a weight-only change re-ranks without the AI", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Criterion 1 weight"), { target: { value: "20" } });
    const button = screen.getByRole("button", { name: "Save & re-rank" });
    fireEvent.click(button);
    await vi.waitFor(() => expect(saveRubric).toHaveBeenCalled());
    const [, sent, opts] = saveRubric.mock.calls[0];
    expect(sent).toEqual([
      { id: "t1", name: "Evidence", description: "Claims backed by data", weight: 20 },
      { id: "t2", name: "Clarity", description: "Reads in one pass", weight: 40 },
    ]);
    expect(opts).toEqual({ regrade: true });
  });

  test("changing what a criterion says asks the AI to re-read everyone — after a confirm", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Criterion 2 description"), {
      target: { value: "Reads in one pass, no jargon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & regrade 12" }));
    expect(saveRubric).not.toHaveBeenCalled();
    expect(screen.getByText(/re-reads all 12 submissions/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Regrade" }));
    await vi.waitFor(() => expect(saveRubric).toHaveBeenCalled());
  });

  test("an owned order is warned about even for a weights-only re-rank", () => {
    setup({ ownsOrder: true });
    fireEvent.change(screen.getByLabelText("Criterion 1 weight"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & re-rank" }));
    expect(saveRubric).not.toHaveBeenCalled();
    expect(screen.getByText(/manual reordering is replaced/)).toBeTruthy();
  });

  test("before grading it's a plain save, and an untouched grid drafts from the taste file", async () => {
    setup({ phase: "open", autoDraftFrom: "taste-v1" });
    await vi.waitFor(() => expect(draftRubricFromTaste).toHaveBeenCalledWith("a1"));
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    fireEvent.change(screen.getByLabelText("Criterion 3 name"), { target: { value: "Originality" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rubric" }));
    await vi.waitFor(() => expect(saveRubric).toHaveBeenCalled());
    expect(saveRubric.mock.calls[0][2]).toEqual({ regrade: false });
    expect(saveRubric.mock.calls[0][1][2]).toEqual({
      name: "Originality",
      description: "",
      weight: 10,
    });
  });

  test("read-only while a regrade runs", () => {
    setup({ regrade: { done: 3, total: 12 } });
    expect(screen.getByText(/Regrading — 3 of\s+12 re-read/)).toBeTruthy();
    expect((screen.getByLabelText("Criterion 1 name") as HTMLInputElement).disabled).toBe(true);
  });
});
