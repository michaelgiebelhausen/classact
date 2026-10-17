import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { RankedList, type RankedStudent } from "@/components/features/assignments/RankedList";
import type { Band } from "@/lib/bands";

/**
 * The list is where band math meets the professor's hands, and the wiring
 * between them is what unit tests on computeScores cannot reach: whether the
 * row someone drags is the row that moves, whether the line they nudge lands
 * between the rows they meant, and whether the number beside a name is the
 * number that would actually be published.
 */

const students: RankedStudent[] = Array.from({ length: 6 }, (_, i) => ({
  submissionId: `s${i}`,
  name: `Student ${i}`,
  photoUrl: null,
  score: 100 - i * 10,
  comparisons: i === 5 ? 0 : 2,
}));

const bands: Band[] = [
  { label: "A", value: 90 },
  { label: "B", value: 80 },
];

function setup(overrides: Partial<React.ComponentProps<typeof RankedList>> = {}) {
  const onReorder = vi.fn();
  const onBandsChange = vi.fn();
  const onOpen = vi.fn();
  render(
    <RankedList
      students={students}
      bands={bands}
      dividers={[2]}
      scoreMode="stepped"
      points={100}
      canReorder
      canEditBands
      onReorder={onReorder}
      onBandsChange={onBandsChange}
      onOpen={onOpen}
      openId={null}
      {...overrides}
    />
  );
  return { onReorder, onBandsChange, onOpen };
}

describe("RankedList", () => {
  test("shows each row the points its band awards", () => {
    setup();
    const rows = screen.getAllByRole("listitem");
    // Rows above the line earn the top band, the rest the second.
    const rowText = rows.map((r) => r.textContent ?? "");
    const withNames = rowText.filter((t) => t.includes("Student"));
    expect(withNames[0]).toContain("90");
    expect(withNames[1]).toContain("90");
    expect(withNames[2]).toContain("80");
    expect(withNames[5]).toContain("80");
  });

  test("flags a submission no human has compared", () => {
    setup();
    expect(screen.getByText("no human eyes")).toBeInTheDocument();
  });

  test("lays each rubric theme's score on the row, in rubric order", () => {
    setup({
      themes: ["Sources", "Depth"],
      students: students.map((s, i) =>
        i === 0 ? { ...s, themeScores: [8, null] } : s
      ),
    });
    const row = screen.getByRole("button", { name: "Student 0" }).closest("li")!;
    expect(within(row).getByLabelText("Sources: 8 of 10")).toBeInTheDocument();
    expect(within(row).getByLabelText("Depth: not scored")).toBeInTheDocument();
    // A row without scores still holds its columns, so the grid stays aligned.
    const other = screen.getByRole("button", { name: "Student 1" }).closest("li")!;
    expect(within(other).getByLabelText("Sources: not scored")).toBeInTheDocument();
  });

  test("marks the rows the professor has already read, unless one is open", () => {
    setup({
      students: students.map((s, i) => (i <= 1 ? { ...s, viewed: true } : s)),
      openId: "s1",
    });
    const row = (name: string) =>
      screen.getByRole("button", { name }).closest("li")!;
    expect(row("Student 0")).toHaveAttribute("data-viewed");
    expect(row("Student 0").className).toContain("bg-green-500/10");
    expect(within(row("Student 0")).getByText("(already read)")).toBeInTheDocument();
    // The open row keeps its own highlight while it's open.
    expect(row("Student 1").className).toContain("bg-primary/5");
    expect(row("Student 1").className).not.toContain("bg-green-500/10");
    expect(row("Student 2")).not.toHaveAttribute("data-viewed");
  });

  test("moving a student down reports the position they land on", () => {
    const { onReorder } = setup();
    fireEvent.keyDown(screen.getByLabelText(/Reorder Student 0/), {
      key: "ArrowDown",
    });
    expect(onReorder).toHaveBeenCalledWith("s0", 1, [2]);
  });

  test("dragging a student into the top band grows it, not pushes one out", () => {
    const { onReorder } = setup();
    // Two in the top band (s0, s1); s4 dropped on s1 joins them.
    fireEvent.dragStart(screen.getByLabelText(/Reorder Student 4/));
    const target = screen.getByRole("button", { name: "Student 1" }).closest("li")!;
    fireEvent.drop(target, { clientY: 0 });
    expect(onReorder).toHaveBeenCalledWith("s4", 1, [3]);
  });

  test("an arrow key at a band's edge steps over the line, passing no one", () => {
    const { onReorder } = setup();
    // s2 heads the second band; one press up puts it at the top band's foot.
    fireEvent.keyDown(screen.getByLabelText(/Reorder Student 2/), { key: "ArrowUp" });
    expect(onReorder).toHaveBeenLastCalledWith("s2", 2, [3]);
    // s1 is the top band's foot; one press down drops it below the line.
    fireEvent.keyDown(screen.getByLabelText(/Reorder Student 1/), { key: "ArrowDown" });
    expect(onReorder).toHaveBeenLastCalledWith("s1", 1, [1]);
  });

  test("the top row cannot be moved above itself", () => {
    const { onReorder } = setup();
    fireEvent.keyDown(screen.getByLabelText(/Reorder Student 0/), {
      key: "ArrowUp",
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  test("nudging a grade line moves it one row and keeps the bands", () => {
    const { onBandsChange } = setup();
    const line = screen.getByRole("slider");
    expect(line).toHaveAttribute("aria-valuenow", "2");
    fireEvent.keyDown(line, { key: "ArrowUp" });
    expect(onBandsChange).toHaveBeenCalledWith(bands, [1]);
  });

  test("a locked list offers no drag handles and says why", () => {
    setup({ canReorder: false, lockedReason: "Peer grading is still open." });
    expect(screen.getByText("Peer grading is still open.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Reorder Student 0/)).toBeDisabled();
  });

  test("a published list cannot be re-banded", () => {
    setup({ canReorder: false, canEditBands: false });
    expect(screen.getByLabelText("Label for the top band")).toBeDisabled();
    expect(screen.queryByText("Add band")).not.toBeInTheDocument();
  });

  test("opening a row reports which submission to read", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Student 3" }));
    expect(onOpen).toHaveBeenCalledWith("s3");
  });

  test("linear scoring spreads the top band up to full marks", () => {
    setup({ scoreMode: "linear" });
    const rows = screen
      .getAllByRole("listitem")
      .map((r) => r.textContent ?? "")
      .filter((t) => t.includes("Student"));
    // Top band holds two rows: 90 at the bottom, full marks at the top.
    expect(rows[0]).toContain("100");
    expect(rows[1]).toContain("90");
  });

  test("an empty band renders its line without swallowing a row", () => {
    setup({ dividers: [0] });
    // Every student still appears, all in the lower band.
    for (const student of students) {
      expect(screen.getByRole("button", { name: student.name })).toBeInTheDocument();
    }
    const rows = screen
      .getAllByRole("listitem")
      .map((r) => r.textContent ?? "")
      .filter((t) => t.includes("Student"));
    expect(rows.every((r) => r.includes("80"))).toBe(true);
  });

  test("the band label a professor types reaches the change handler", () => {
    const { onBandsChange } = setup();
    fireEvent.change(screen.getByLabelText("Label for the top band"), {
      target: { value: "Excellent" },
    });
    expect(onBandsChange).toHaveBeenLastCalledWith(
      [{ label: "Excellent", value: 90 }, bands[1]],
      [2]
    );
  });

  test("the line names the band it opens, for a screen reader", () => {
    setup();
    const line = screen.getByRole("slider");
    expect(line).toHaveAccessibleName(/above B/);
    const group = within(line.closest("li")!);
    expect(group.getByLabelText("Points for band 2")).toHaveValue(80);
  });
});
