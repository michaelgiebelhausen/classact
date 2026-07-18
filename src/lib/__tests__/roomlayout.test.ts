import { describe, expect, it } from "vitest";
import {
  buildLayout,
  gridLayout,
  layoutToSeats,
  validateLayout,
  type RoomLayout,
} from "@/lib/roomlayout";

function byLabel(layout: RoomLayout) {
  const seats = layoutToSeats(layout);
  return new Map(seats.map((s) => [s.label, s]));
}

describe("layoutToSeats — classroom grid", () => {
  it("reproduces the legacy rows × cols grid", () => {
    const seats = layoutToSeats(gridLayout(3, 4));
    expect(seats).toHaveLength(12);
    const labels = seats.map((s) => s.label);
    expect(labels).toContain("A1");
    expect(labels).toContain("C4");
    const a1 = seats.find((s) => s.label === "A1")!;
    const a2 = seats.find((s) => s.label === "A2")!;
    const b1 = seats.find((s) => s.label === "B1")!;
    // Front-left seat at origin, unit spacing across, row gap down.
    expect(a1.x).toBe(0);
    expect(a1.y).toBe(0);
    expect(a2.x - a1.x).toBeCloseTo(1, 5);
    expect(b1.y).toBeGreaterThan(a1.y);
    expect(a1.row).toBe(0);
    expect(a1.col).toBe(0);
  });

  it("links grid neighbors like the old front/back/left/right", () => {
    const seats = byLabel(gridLayout(3, 3));
    const b2 = seats.get("B2")!;
    expect(b2.neighbors).toEqual({
      left: "B1",
      right: "B3",
      front: "A2",
      back: "C2",
    });
    // Corners have only two links.
    expect(seats.get("A1")!.neighbors).toEqual({ right: "A2", back: "B1" });
  });

  it("aisles split left/right adjacency and add a physical gap", () => {
    const layout = buildLayout({ type: "classroom", rows: 1, cols: 6, aisleCount: 1 });
    const seats = byLabel(layout);
    // Aisle after seat 3: A3 and A4 are not neighbors, and are >1 apart.
    expect(seats.get("A3")!.neighbors.right).toBeUndefined();
    expect(seats.get("A4")!.neighbors.left).toBeUndefined();
    expect(seats.get("A4")!.x - seats.get("A3")!.x).toBeGreaterThan(1.5);
    // Elsewhere adjacency is intact.
    expect(seats.get("A2")!.neighbors.right).toBe("A3");
  });
});

describe("layoutToSeats — auditorium", () => {
  const params = {
    type: "auditorium" as const,
    rows: 5,
    frontSeats: 6,
    backSeats: 12,
    aisleCount: 1,
    curve: 0.5,
    balconyRows: 0,
  };

  it("front rows are narrower than back rows", () => {
    const seats = layoutToSeats(buildLayout(params));
    const frontCount = seats.filter((s) => s.row === 0).length;
    const backCount = seats.filter((s) => s.row === 4).length;
    expect(frontCount).toBe(6);
    expect(backCount).toBe(12);
  });

  it("curved rows still link front/back radially", () => {
    const seats = byLabel(buildLayout({ ...params, frontSeats: 8, backSeats: 8 }));
    // Same-width curved rows: center seats align front/back.
    expect(seats.get("B4")!.neighbors.front).toBe("A4");
    expect(seats.get("B4")!.neighbors.back).toBe("C4");
  });

  it("balcony seats sit beyond a gap, letters continue, no cross-level links", () => {
    const layout = buildLayout({ ...params, balconyRows: 2 });
    const seats = layoutToSeats(layout);
    const main = seats.filter((s) => s.section === "main");
    const balcony = seats.filter((s) => s.section === "balcony");
    expect(balcony.length).toBe(24); // 2 rows × 12
    // True separation: no balcony seat sits near a main-floor seat. (Row
    // centers are BALCONY_GAP apart; curved edges dip but stay clear.)
    let minPairDist = Infinity;
    for (const m of main)
      for (const b of balcony)
        minPairDist = Math.min(minPairDist, Math.hypot(m.x - b.x, m.y - b.y));
    expect(minPairDist).toBeGreaterThan(1.5);
    // Letters continue after the main block (rows 0–4 → F onward).
    expect(balcony.some((s) => s.label.startsWith("F"))).toBe(true);
    // No balcony seat links forward into the main floor.
    for (const s of balcony) {
      for (const target of Object.values(s.neighbors)) {
        expect(balcony.some((b) => b.label === target)).toBe(true);
      }
    }
  });
});

describe("layoutToSeats — tables", () => {
  it("seminar table seats sit around a perimeter with wraparound adjacency", () => {
    const layout = buildLayout({ type: "seminar", shape: "oval", seats: 8 });
    const seats = layoutToSeats(layout);
    expect(seats).toHaveLength(8);
    expect(seats.every((s) => s.tableId === "table")).toBe(true);
    // Plain numeric labels for a single seminar table.
    expect(seats.map((s) => s.label)).toContain("1");
    const first = seats.find((s) => s.label === "1")!;
    const last = seats.find((s) => s.label === "8")!;
    // Closed perimeter: seat 1 and seat 8 are adjacent.
    expect(first.neighbors.left).toBe("8");
    expect(last.neighbors.right).toBe("1");
  });

  it("a U-shaped table does not wrap around the open end", () => {
    const layout = buildLayout({ type: "seminar", shape: "ushape", seats: 6 });
    const seats = byLabel(layout);
    expect(seats.get("1")!.neighbors.left).toBeUndefined();
    expect(seats.get("6")!.neighbors.right).toBeUndefined();
    expect(seats.get("3")!.neighbors.right).toBe("4");
  });

  it("pods get per-table letters and neighbors never leave the table", () => {
    const layout = buildLayout({ type: "pods", tables: 4, seatsPerTable: 5 });
    const seats = layoutToSeats(layout);
    expect(seats).toHaveLength(20);
    expect(seats.map((s) => s.label)).toContain("1A");
    expect(seats.map((s) => s.label)).toContain("4E");
    const t1 = seats.filter((s) => s.tableId === "t1");
    for (const s of t1) {
      for (const target of Object.values(s.neighbors)) {
        expect(t1.some((m) => m.label === target)).toBe(true);
      }
    }
    // Tables are spatially separated: nearest cross-table seats are farther
    // apart than in-table neighbors.
    const t2 = seats.filter((s) => s.tableId === "t2");
    let minCross = Infinity;
    for (const a of t1)
      for (const b of t2)
        minCross = Math.min(minCross, Math.hypot(a.x - b.x, a.y - b.y));
    expect(minCross).toBeGreaterThan(1.2);
  });
});

describe("layoutToSeats — removals and validation", () => {
  it("removed seats vanish and their neighbor links are pruned", () => {
    const layout: RoomLayout = {
      ...gridLayout(2, 3),
      removedSeats: ["A2"],
    };
    const seats = byLabel(layout);
    expect(seats.has("A2")).toBe(false);
    // A1's right link pointed at A2 — pruned, not bridged to A3.
    expect(seats.get("A1")!.neighbors.right).toBeUndefined();
    expect(seats.get("A3")!.neighbors.left).toBeUndefined();
    expect(seats.get("B2")!.neighbors.front).toBeUndefined();
  });

  it("labels stay stable across removals", () => {
    const layout: RoomLayout = { ...gridLayout(1, 4), removedSeats: ["A2"] };
    const labels = layoutToSeats(layout).map((s) => s.label);
    expect(labels).toEqual(["A1", "A3", "A4"]);
  });

  it("rejects oversized and empty rooms", () => {
    expect(
      validateLayout(buildLayout({ type: "classroom", rows: 30, cols: 30, aisleCount: 0 }))
    ).toMatch(/limited/);
    expect(
      validateLayout({ version: 1, type: "classroom", sections: [] })
    ).toMatch(/at least one/);
    const allRemoved: RoomLayout = {
      ...gridLayout(1, 2),
      removedSeats: ["A1", "A2"],
    };
    expect(validateLayout(allRemoved)).toMatch(/at least one seat/);
  });

  it("accepts every preset at default-ish knobs", () => {
    expect(validateLayout(buildLayout({ type: "classroom", rows: 6, cols: 8, aisleCount: 1 }))).toBeNull();
    expect(validateLayout(buildLayout({ type: "seminar", shape: "rect", seats: 12 }))).toBeNull();
    expect(validateLayout(buildLayout({ type: "horseshoe", rows: 3, frontSeats: 8 }))).toBeNull();
    expect(
      validateLayout(
        buildLayout({
          type: "auditorium",
          rows: 10,
          frontSeats: 10,
          backSeats: 18,
          aisleCount: 2,
          curve: 0.4,
          balconyRows: 2,
        })
      )
    ).toBeNull();
    expect(validateLayout(buildLayout({ type: "pods", tables: 6, seatsPerTable: 6 }))).toBeNull();
  });

  it("is deterministic", () => {
    const layout = buildLayout({
      type: "auditorium",
      rows: 8,
      frontSeats: 8,
      backSeats: 14,
      aisleCount: 1,
      curve: 0.6,
      balconyRows: 1,
    });
    expect(layoutToSeats(layout)).toEqual(layoutToSeats(layout));
  });
});
