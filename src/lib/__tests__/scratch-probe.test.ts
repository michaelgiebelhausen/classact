import { describe, it, expect } from "vitest";
import {
  blocksForParams,
  buildLayout,
  validateLayout,
  layoutToSeats,
  type PresetParams,
} from "@/lib/roomlayout";

describe("probe", () => {
  it("horseshoe blocks are ignored", () => {
    const edited = {
      type: "horseshoe",
      rows: 3,
      frontSeats: 8,
      blocks: [{ front: 20, back: 24 }],
    } as unknown as PresetParams;
    // What the designer's block editor would show after the edit:
    console.log("blocksForParams after edit:", JSON.stringify(blocksForParams(edited)));
    const layout = buildLayout(edited);
    console.log("horseshoe rowSeats:", JSON.stringify((layout.sections[0] as any).rowSeats));
  });

  it("seminar endSeats goes stale when seats shrink", () => {
    const p = { type: "seminar", shape: "rect", seats: 6, endSeats: 5 } as PresetParams;
    const layout = buildLayout(p);
    console.log("seminar preview seats:", layoutToSeats(layout).length);
    console.log("seminar validate:", validateLayout(layout));
  });

  it("wide blocks preview but fail validation", () => {
    const p = {
      type: "classroom",
      rows: 3,
      cols: 8,
      aisleCount: 1,
      blocks: [
        { front: 20, back: 20 },
        { front: 25, back: 25 },
      ],
    } as unknown as PresetParams;
    const layout = buildLayout(p);
    console.log("wide preview seats:", layoutToSeats(layout).length);
    console.log("wide validate:", validateLayout(layout));
  });

  it("zero blocks", () => {
    const p = {
      type: "classroom",
      rows: 3,
      cols: 8,
      aisleCount: 1,
      blocks: [
        { front: 0, back: 0 },
        { front: 0, back: 0 },
      ],
    } as unknown as PresetParams;
    const layout = buildLayout(p);
    console.log("zero rowSeats:", JSON.stringify((layout.sections[0] as any).rowSeats));
    try {
      console.log("zero preview seats:", layoutToSeats(layout).length);
    } catch (e) {
      console.log("zero preview threw:", (e as Error).message);
    }
  });

  it("half-unit snap of incremental deltas", () => {
    // Simulates moveTable with a *fresh* base each step (best case).
    let x = 0;
    for (let i = 0; i < 60; i++) {
      const dx = 0.09; // ~4px per pointermove at 44px/unit
      x = Math.round(Math.max(0, x + dx) * 2) / 2;
    }
    console.log("slow drag total travel (units):", x);
  });

  it("classroom balcony/auditorium blocks respected", () => {
    const p = {
      type: "auditorium",
      rows: 4,
      frontSeats: 10,
      backSeats: 16,
      aisleCount: 2,
      curve: 0.4,
      balconyRows: 0,
      blocks: [
        { front: 2, back: 4 },
        { front: 6, back: 6 },
        { front: 2, back: 4 },
      ],
    } as unknown as PresetParams;
    const layout = buildLayout(p);
    console.log("aud rowBlocks:", JSON.stringify((layout.sections[0] as any).rowBlocks));
    expect(validateLayout(layout)).toBeNull();
  });
});
