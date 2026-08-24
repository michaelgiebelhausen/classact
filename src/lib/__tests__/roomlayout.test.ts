import { describe, expect, it } from "vitest";
import {
  blockRowWidths,
  blocksForParams,
  buildLayout,
  gridLayout,
  layoutToSeats,
  podsFromParams,
  resizeRowWidths,
  resolvePod,
  surviveRemovals,
  validateLayout,
  type PodSpec,
  type RoomLayout,
  type SideSeats,
} from "@/lib/roomlayout";

function byLabel(layout: RoomLayout) {
  const seats = layoutToSeats(layout);
  return new Map(seats.map((s) => [s.label, s]));
}

describe("legacy geometry is preserved until blocks are edited", () => {
  // Seat neighbors are persisted and drive check-in verification, so an
  // untouched preset must rebuild the exact room it built before.
  const auditorium = {
    type: "auditorium" as const,
    rows: 10,
    frontSeats: 10,
    backSeats: 16,
    aisleCount: 2,
    curve: 0.4,
    balconyRows: 0,
  };

  it("keeps the interpolated row profile (not per-block rounding)", () => {
    const layout = buildLayout(auditorium);
    const section = layout.sections[0];
    if (section.kind !== "rows") throw new Error("expected a rows section");
    expect(section.rowSeats).toEqual([10, 11, 11, 12, 13, 13, 14, 15, 15, 16]);
    // No rowBlocks means the legacy aisle-scaling path stays in charge.
    expect(section.rowBlocks).toBeUndefined();
  });

  it("rebuilds an identical room when reopened from stored params", () => {
    const first = layoutToSeats(buildLayout(auditorium));
    const reopened = layoutToSeats(
      buildLayout(buildLayout(auditorium).params as unknown as typeof auditorium)
    );
    expect(reopened).toEqual(first);
  });

  it("gives the block editor the same seat totals the room actually has", () => {
    const blocks = blocksForParams(auditorium);
    expect(blocks.reduce((a, b) => a + b.front, 0)).toBe(10);
    expect(blocks.reduce((a, b) => a + b.back, 0)).toBe(16);
  });

  it("never drops a block when front and back split unevenly", () => {
    // front 3 / back 24 across 3 aisles used to zip to 3 blocks and lose
    // the fourth, silently shrinking the back row.
    const blocks = blocksForParams({
      type: "auditorium",
      rows: 6,
      frontSeats: 3,
      backSeats: 24,
      aisleCount: 3,
      curve: 0,
      balconyRows: 1,
    });
    expect(blocks.reduce((a, b) => a + b.back, 0)).toBe(24);
    expect(blocks.reduce((a, b) => a + b.front, 0)).toBe(3);
    // A block may be empty at the front and fill in further back — a narrow
    // front row is real — but every block must hold seats somewhere.
    expect(blocks.every((b) => b.front > 0 || b.back > 0)).toBe(true);
  });
});

describe("horseshoe stays editable", () => {
  it("honors an edited block instead of the fixed +2-per-row wrap", () => {
    const layout = buildLayout({
      type: "horseshoe",
      rows: 3,
      frontSeats: 8,
      backSeats: 20,
      blocks: [{ front: 8, back: 20 }],
    });
    const section = layout.sections[0];
    if (section.kind !== "rows") throw new Error("expected a rows section");
    expect(section.rowSeats).toEqual([8, 14, 20]);
  });

  it("still wraps by two per row when untouched", () => {
    const layout = buildLayout({ type: "horseshoe", rows: 3, frontSeats: 8 });
    const section = layout.sections[0];
    if (section.kind !== "rows") throw new Error("expected a rows section");
    expect(section.rowSeats).toEqual([8, 10, 12]);
  });
});

describe("validateLayout rejects hostile input", () => {
  it("refuses a row-letter offset that would spin the label generator", () => {
    const evil: RoomLayout = {
      version: 1,
      type: "classroom",
      sections: [
        {
          id: "main",
          kind: "rows",
          rowSeats: [2],
          rowLetterStart: Number.POSITIVE_INFINITY,
        },
      ],
    };
    expect(validateLayout(evil)).toMatch(/row lettering/i);
  });
});

describe("column blocks", () => {
  it("sizes each aisle-separated block independently", () => {
    // The case the old model couldn't express: a wide middle block that
    // stays wide while the outside blocks taper.
    const layout = buildLayout({
      type: "auditorium",
      rows: 3,
      frontSeats: 0,
      backSeats: 0,
      aisleCount: 2,
      curve: 0,
      balconyRows: 0,
      blocks: [
        { front: 2, back: 4 },
        { front: 6, back: 6 },
        { front: 2, back: 4 },
      ],
    });
    const section = layout.sections[0];
    if (section.kind !== "rows") throw new Error("expected a rows section");
    expect(section.rowBlocks).toEqual([
      [2, 6, 2],
      [3, 6, 3],
      [4, 6, 4],
    ]);
    expect(section.rowSeats).toEqual([10, 12, 14]);
    expect(layoutToSeats(layout)).toHaveLength(36);
  });

  it("keeps blocks apart with aisle gaps and blocks neighbor links across them", () => {
    const layout = buildLayout({
      type: "classroom",
      rows: 1,
      cols: 0,
      aisleCount: 0,
      blocks: [
        { front: 2, back: 2 },
        { front: 2, back: 2 },
      ],
    });
    const seats = layoutToSeats(layout);
    const a2 = seats.find((s) => s.label === "A2")!;
    const a3 = seats.find((s) => s.label === "A3")!;
    // A2 ends the first block, A3 starts the second — gap, and no link.
    expect(a3.x - a2.x).toBeGreaterThan(1);
    expect(a2.neighbors.right).toBeUndefined();
    expect(a3.neighbors.left).toBeUndefined();
  });

  it("derives legacy blocks so rooms saved before the block model are unchanged", () => {
    const legacy = blocksForParams({
      type: "classroom",
      rows: 5,
      cols: 8,
      aisleCount: 2,
    });
    expect(legacy.reduce((a, b) => a + b.front, 0)).toBe(8);
    expect(legacy).toHaveLength(3);
    // A flat classroom's back row matches its front row.
    expect(legacy.every((b) => b.front === b.back)).toBe(true);
  });

  it("rejects blocks that disagree with the row totals", () => {
    const broken: RoomLayout = {
      version: 1,
      type: "classroom",
      sections: [
        { id: "main", kind: "rows", rowSeats: [8], rowBlocks: [[3, 3]] },
      ],
    };
    expect(validateLayout(broken)).toMatch(/don't add up/i);
  });
});

describe("rectangular tables", () => {
  it("seats the short ends exactly and splits the rest across the long sides", () => {
    const layout = buildLayout({
      type: "seminar",
      shape: "rect",
      seats: 12,
      endSeats: 2,
    });
    const seats = layoutToSeats(layout);
    expect(seats).toHaveLength(12);
    const xs = seats.map((s) => s.x);
    const ys = seats.map((s) => s.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    // Two seats on each end column, four along each long side.
    const onLeftEnd = seats.filter((s) => Math.abs(s.x - minX) < 0.01);
    const onRightEnd = seats.filter((s) => Math.abs(s.x - maxX) < 0.01);
    expect(onLeftEnd).toHaveLength(2);
    expect(onRightEnd).toHaveLength(2);
    const minY = Math.min(...ys);
    expect(seats.filter((s) => Math.abs(s.y - minY) < 0.01)).toHaveLength(4);
  });

  it("refuses an end count that would leave the sides empty", () => {
    const layout = buildLayout({ type: "seminar", shape: "rect", seats: 6 });
    const section = layout.sections[0];
    if (section.kind !== "table") throw new Error("expected a table section");
    expect(validateLayout({ ...layout, sections: [{ ...section, endSeats: 3 }] })).toMatch(
      /long side/i
    );
  });
});

describe("pods", () => {
  it("honors dragged table positions", () => {
    const layout = buildLayout({
      type: "pods",
      tables: 2,
      seatsPerTable: 4,
      positions: [
        { x: 0, y: 0 },
        { x: 12, y: 6 },
      ],
    });
    const second = layout.sections[1];
    if (second.kind !== "table") throw new Error("expected a table section");
    expect(second.cx).toBe(12);
    expect(second.cy).toBe(6);
    // Both tables still produce seats, and the far one really is farther out.
    const seats = layoutToSeats(layout);
    expect(seats).toHaveLength(8);
    expect(Math.max(...seats.map((s) => s.x))).toBeGreaterThan(10);
  });
});

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

describe("wall tables — a rect pushed against the wall", () => {
  // Three sides of two, one side bare: the arrangement that started this.
  const wallPod = (sideSeats: SideSeats): RoomLayout =>
    buildLayout({
      type: "pods",
      tables: 1,
      seatsPerTable: 6,
      shape: "rect",
      podList: [{ n: 1, x: 0, y: 0, shape: "rect", sideSeats }],
    });

  it("seats exactly the number told on each occupied edge, none on the bare one", () => {
    const seats = layoutToSeats(wallPod([2, 2, 2, 0]));
    expect(seats).toHaveLength(6);
    expect(seats.map((s) => s.label)).toEqual(["1A", "1B", "1C", "1D", "1E", "1F"]);
    const minX = Math.min(...seats.map((s) => s.x));
    const maxX = Math.max(...seats.map((s) => s.x));
    const minY = Math.min(...seats.map((s) => s.y));
    const maxY = Math.max(...seats.map((s) => s.y));
    const on = (pick: (s: (typeof seats)[number]) => number, value: number) =>
      seats.filter((s) => Math.abs(pick(s) - value) < 0.01);
    expect(on((s) => s.y, minY)).toHaveLength(2); // front edge
    expect(on((s) => s.x, maxX)).toHaveLength(2); // right edge
    expect(on((s) => s.y, maxY)).toHaveLength(2); // back edge
    // The left edge is the wall: nobody sits flush against it. The two seats
    // at minX are the outermost front and back chairs, not a seated edge.
    const onWall = on((s) => s.x, minX);
    expect(onWall.every((s) => Math.abs(s.y - minY) < 0.01 || Math.abs(s.y - maxY) < 0.01)).toBe(
      true
    );
  });

  it("the ring closes around the bare edge — the flanking pair are neighbors", () => {
    const seats = byLabel(wallPod([2, 2, 2, 0]));
    // Walk the whole ring: every seat links both ways, 1F back round to 1A.
    expect(seats.get("1A")!.neighbors.right).toBe("1B");
    expect(seats.get("1C")!.neighbors.right).toBe("1D");
    expect(seats.get("1E")!.neighbors.right).toBe("1F");
    expect(seats.get("1F")!.neighbors.right).toBe("1A");
    expect(seats.get("1A")!.neighbors.left).toBe("1F");
    // Perimeter tables never claim front/back.
    expect(seats.get("1A")!.neighbors.front).toBeUndefined();
  });

  it("strip it to two edges and it stops wrapping — that's a bench, not a ring", () => {
    const corner = byLabel(wallPod([2, 2, 0, 0]));
    expect(corner.get("1A")!.neighbors.left).toBeUndefined();
    expect(corner.get("1D")!.neighbors.right).toBeUndefined();
    expect(corner.get("1B")!.neighbors.right).toBe("1C");
    const bench = byLabel(wallPod([4, 0, 0, 0]));
    expect(bench.get("1A")!.neighbors.left).toBeUndefined();
    expect(bench.get("1D")!.neighbors.right).toBeUndefined();
  });

  it("mixed rooms: wall tables and round tables side by side", () => {
    const layout = buildLayout({
      type: "pods",
      tables: 2,
      seatsPerTable: 5,
      podList: [
        { n: 1, x: 0, y: 0, shape: "rect", sideSeats: [2, 2, 2, 0] },
        { n: 2, x: 12, y: 0 },
      ],
    });
    const seats = layoutToSeats(layout);
    expect(seats.filter((s) => s.tableId === "t1")).toHaveLength(6);
    expect(seats.filter((s) => s.tableId === "t2")).toHaveLength(5);
    expect(validateLayout(layout)).toBeNull();
  });

  it("rejects edge counts that contradict the table", () => {
    const layout = buildLayout({ type: "seminar", shape: "rect", seats: 6 });
    const section = layout.sections[0];
    if (section.kind !== "table") throw new Error("expected a table section");
    const withSides = (patch: Record<string, unknown>) =>
      validateLayout({ ...layout, sections: [{ ...section, ...patch }] });
    expect(withSides({ sideSeats: [2, 2, 2, 2] })).toMatch(/add up/i);
    expect(withSides({ sideSeats: [2, 2, 2] })).toMatch(/four sides/i);
    expect(withSides({ sideSeats: [3, 3, 0, 0], endSeats: 1 })).toMatch(/not both/i);
    expect(withSides({ shape: "oval", sideSeats: [2, 2, 2, 0] })).toMatch(/rectangular/i);
    expect(withSides({ sideSeats: [2, 2, 2, 0] })).toBeNull();
  });
});

describe("pods keep their numbers", () => {
  it("deleting a middle table leaves every other label untouched", () => {
    const pods: PodSpec[] = [1, 2, 3, 4].map((n) => ({ n, x: n * 8, y: 0 }));
    const before = layoutToSeats(
      buildLayout({ type: "pods", tables: 4, seatsPerTable: 4, podList: pods })
    );
    const after = layoutToSeats(
      buildLayout({
        type: "pods",
        tables: 3,
        seatsPerTable: 4,
        podList: pods.filter((p) => p.n !== 3),
      })
    );
    // Table 4 is still table 4 — the student in 4A is still in 4A.
    expect(after.map((s) => s.label)).toContain("4A");
    expect(after.map((s) => s.label)).not.toContain("3A");
    const stillThere = new Set(after.map((s) => s.label));
    for (const seat of before) {
      if (seat.tableId === "t3") continue;
      expect(stillThere.has(seat.label)).toBe(true);
    }
  });

  it("per-pod overrides beat the room default; untouched pods follow it", () => {
    const seats = layoutToSeats(
      buildLayout({
        type: "pods",
        tables: 2,
        seatsPerTable: 4,
        podList: [
          { n: 1, x: 0, y: 0, seats: 8 },
          { n: 2, x: 14, y: 0 },
        ],
      })
    );
    expect(seats.filter((s) => s.tableId === "t1")).toHaveLength(8);
    expect(seats.filter((s) => s.tableId === "t2")).toHaveLength(4);
  });

  it("edge seating is dormant, not lost, while a pod is round", () => {
    const pod: PodSpec = { n: 1, x: 0, y: 0, shape: "oval", sideSeats: [2, 2, 2, 0] };
    const round = resolvePod(pod, { seats: 5, shape: "oval" });
    expect(round.sideSeats).toBeUndefined();
    expect(round.seats).toBe(5);
    const rect = resolvePod({ ...pod, shape: "rect" }, { seats: 5, shape: "oval" });
    expect(rect.sideSeats).toEqual([2, 2, 2, 0]);
    expect(rect.seats).toBe(6);
  });
});

describe("stepped rows — eight across, then nine", () => {
  const stepped = {
    type: "auditorium" as const,
    rows: 8,
    frontSeats: 8,
    backSeats: 9,
    aisleCount: 0,
    curve: 0,
    balconyRows: 0,
    blocks: [{ front: 8, back: 9, rows: [8, 8, 8, 8, 9, 9, 9, 9] }],
  };

  const rowSeatsOf = (layout: RoomLayout) => {
    const section = layout.sections[0];
    if (section.kind !== "rows") throw new Error("expected a rows section");
    return section.rowSeats;
  };

  it("draws the step exactly", () => {
    const layout = buildLayout(stepped);
    expect(rowSeatsOf(layout)).toEqual([8, 8, 8, 8, 9, 9, 9, 9]);
    expect(validateLayout(layout)).toBeNull();
  });

  it("holds steps the front/back ramp can't reach", () => {
    // A +1 spread evenly over 8 rows happens to break where this room does,
    // so interpolation gets Mike's room right by luck. Move the step and the
    // ramp can't follow — which is the whole point of saying it outright.
    expect(rowSeatsOf(buildLayout({ ...stepped, blocks: [{ front: 8, back: 9 }] }))).toEqual(
      [8, 8, 8, 8, 9, 9, 9, 9]
    );
    const lateStep = { front: 8, back: 9, rows: [8, 8, 8, 8, 8, 8, 9, 9] };
    expect(rowSeatsOf(buildLayout({ ...stepped, blocks: [lateStep] }))).toEqual(
      [8, 8, 8, 8, 8, 8, 9, 9]
    );
    const bigJump = { front: 6, back: 14, rows: [6, 6, 6, 14, 14, 14, 14, 14] };
    expect(rowSeatsOf(buildLayout({ ...stepped, blocks: [bigJump] }))).toEqual(
      [6, 6, 6, 14, 14, 14, 14, 14]
    );
    expect(
      rowSeatsOf(buildLayout({ ...stepped, blocks: [{ front: 6, back: 14 }] }))
    ).toEqual([6, 7, 8, 9, 11, 12, 13, 14]);
  });

  it("steps survive per block when a room has aisles", () => {
    const layout = buildLayout({
      ...stepped,
      blocks: [
        { front: 4, back: 4, rows: [4, 4, 4, 4, 4, 4, 4, 4] },
        { front: 4, back: 5, rows: [4, 4, 4, 4, 5, 5, 5, 5] },
      ],
    });
    const section = layout.sections[0];
    if (section.kind !== "rows") throw new Error("expected a rows section");
    expect(section.rowBlocks).toEqual([
      [4, 4],
      [4, 4],
      [4, 4],
      [4, 4],
      [4, 5],
      [4, 5],
      [4, 5],
      [4, 5],
    ]);
  });

  it("the balcony repeats the real back row, not the ramp's endpoint", () => {
    const layout = buildLayout({ ...stepped, balconyRows: 1 });
    const balcony = layout.sections.find((s) => s.id === "balcony");
    if (!balcony || balcony.kind !== "rows") throw new Error("expected a balcony");
    expect(balcony.rowSeats).toEqual([9]);
  });

  it("changing the row count stretches the step instead of dropping it", () => {
    expect(resizeRowWidths([8, 8, 9, 9], 6)).toEqual([8, 8, 9, 9, 9, 9]);
    expect(resizeRowWidths([8, 8, 9, 9], 3)).toEqual([8, 8, 9]);
    expect(blockRowWidths({ front: 8, back: 9, rows: [8, 8, 9, 9] }, 6)).toEqual([
      8, 8, 9, 9, 9, 9,
    ]);
    // No explicit list: still the front→back ramp.
    expect(blockRowWidths({ front: 2, back: 6 }, 3)).toEqual([2, 4, 6]);
  });
});

describe("removals survive reshaping", () => {
  it("keeps the removals whose seats still exist and drops only the rest", () => {
    const layout = buildLayout({ type: "classroom", rows: 2, cols: 6, aisleCount: 0 });
    // B6 exists here; shrink to 4 columns and it doesn't.
    expect(surviveRemovals(layout, ["A2", "B6"]).sort()).toEqual(["A2", "B6"]);
    const smaller = buildLayout({ type: "classroom", rows: 2, cols: 4, aisleCount: 0 });
    expect(surviveRemovals(smaller, ["A2", "B6"])).toEqual(["A2"]);
  });

  it("holds on to everything when the layout can't be built at all", () => {
    const broken: RoomLayout = { version: 1, type: "classroom", sections: [] };
    expect(surviveRemovals(broken, ["A1"])).toEqual(["A1"]);
  });

  it("a wall table's removals outlive dragging it across the room", () => {
    const pod = (x: number): RoomLayout =>
      buildLayout({
        type: "pods",
        tables: 1,
        seatsPerTable: 6,
        podList: [{ n: 1, x, y: 0, shape: "rect", sideSeats: [2, 2, 2, 0] }],
      });
    expect(surviveRemovals(pod(0), ["1C"])).toEqual(["1C"]);
    expect(surviveRemovals(pod(20), ["1C"])).toEqual(["1C"]);
  });
});

describe("legacy pod rooms rebuild byte-for-byte", () => {
  // These rooms' neighbors are what check-in verifies. Reopening one must not
  // move a single chair.
  const legacy = [
    { type: "pods" as const, tables: 6, seatsPerTable: 5 },
    { type: "pods" as const, tables: 4, seatsPerTable: 8, shape: "rect" as const },
    {
      type: "pods" as const,
      tables: 3,
      seatsPerTable: 6,
      positions: [
        { x: 0, y: 0 },
        { x: 9, y: 2 },
        { x: 18, y: 4 },
      ],
    },
  ];

  it("auto-grid, shapes, and dragged positions all land where they used to", () => {
    for (const params of legacy) {
      const pods = podsFromParams(params);
      expect(pods.map((p) => p.n)).toEqual(
        Array.from({ length: params.tables }, (_, i) => i + 1)
      );
      // No podList means no per-pod overrides — every table takes the default.
      expect(pods.every((p) => p.seats === undefined && p.shape === undefined)).toBe(true);
      const seats = layoutToSeats(buildLayout(params));
      expect(seats).toHaveLength(params.tables * params.seatsPerTable);
      expect(seats.every((s) => s.neighbors.front === undefined)).toBe(true);
      // Reopening from stored params rebuilds the identical room.
      const layout = buildLayout(params);
      const reopened = layoutToSeats(
        buildLayout(layout.params as unknown as typeof params)
      );
      expect(reopened).toEqual(seats);
    }
  });

  it("dragged positions still win, table by table", () => {
    const seats = layoutToSeats(buildLayout(legacy[2]));
    const t3 = seats.filter((s) => s.tableId === "t3");
    expect(t3).toHaveLength(6);
    expect(Math.max(...seats.map((s) => s.x))).toBeGreaterThan(16);
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
