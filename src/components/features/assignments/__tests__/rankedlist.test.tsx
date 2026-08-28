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

  test("moving a student down reports the position they land on", () => {
    const { onReorder } = setup();
    fireEvent.keyDown(screen.getByLabelText(/Reorder Student 0/), {
      key: "ArrowDown",
    });
    expect(onReorder).toHaveBeenCalledWith("s0", 1);
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
