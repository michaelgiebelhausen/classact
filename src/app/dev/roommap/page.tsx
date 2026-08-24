"use client";

import { useMemo } from "react";
import { RoomMap } from "@/components/features/rooms/RoomMap";
import {
  buildLayout,
  layoutToSeats,
  tableFootprint,
  type PresetParams,
  type TableFootprint,
  type TableShape,
} from "@/lib/roomlayout";

/**
 * Dev gallery: every room preset rendered through the real geometry +
 * RoomMap pipeline. No data, no auth — a visual test bench for layouts.
 */

const SAMPLES: Array<{ title: string; params: PresetParams }> = [
  {
    title: "Classroom — 6 × 8, one aisle",
    params: { type: "classroom", rows: 6, cols: 8, aisleCount: 1 },
  },
  {
    title: "Seminar — oval, 12 seats",
    params: { type: "seminar", shape: "oval", seats: 12 },
  },
  {
    title: "Seminar — U-shape, 14 seats",
    params: { type: "seminar", shape: "ushape", seats: 14 },
  },
  {
    title: "Horseshoe — 3 rows",
    params: { type: "horseshoe", rows: 3, frontSeats: 8 },
  },
  {
    title: "Auditorium — 10 rows, 10→16 seats, curve 0.4, 2 aisles",
    params: {
      type: "auditorium",
      rows: 10,
      frontSeats: 10,
      backSeats: 16,
      aisleCount: 2,
      curve: 0.4,
      balconyRows: 0,
    },
  },
  {
    title: "Auditorium with balcony — curve 0.5",
    params: {
      type: "auditorium",
      rows: 8,
      frontSeats: 8,
      backSeats: 14,
      aisleCount: 1,
      curve: 0.5,
      balconyRows: 2,
    },
  },
  {
    title: "Pods — 6 tables of 5",
    params: { type: "pods", tables: 6, seatsPerTable: 5 },
  },
  {
    // The room that motivated per-edge seating: tables shoved against the
    // side walls, chairs on three sides, and one in the middle reachable
    // only from front and back.
    title: "Wall tables — three sides seated, wall side bare",
    params: {
      type: "pods",
      tables: 7,
      seatsPerTable: 6,
      shape: "rect",
      podList: [
        { n: 7, x: 0, y: 0, shape: "rect", sideSeats: [2, 2, 2, 0] },
        { n: 6, x: 0, y: 6, shape: "rect", sideSeats: [2, 2, 2, 0] },
        { n: 4, x: 0, y: 12, shape: "rect", sideSeats: [2, 2, 2, 0] },
        { n: 1, x: 12, y: 0, shape: "rect", sideSeats: [2, 0, 2, 2] },
        { n: 2, x: 12, y: 6, shape: "rect", sideSeats: [2, 0, 2, 2] },
        { n: 3, x: 12, y: 12, shape: "rect", sideSeats: [2, 0, 2, 2] },
        { n: 5, x: 6, y: 12, shape: "rect", sideSeats: [2, 0, 2, 0] },
      ],
    },
  },
  {
    // Steps where interpolation would ramp: four rows of 8, then four of 9.
    title: "Stepped rows — four rows of 8, then four of 9",
    params: {
      type: "auditorium",
      rows: 8,
      frontSeats: 8,
      backSeats: 9,
      aisleCount: 0,
      curve: 0,
      balconyRows: 0,
      blocks: [{ front: 8, back: 9, rows: [8, 8, 8, 8, 9, 9, 9, 9] }],
    },
  },
];

function PresetPreview({ title, params }: { title: string; params: PresetParams }) {
  const seats = useMemo(() => {
    const layout = buildLayout(params);
    const shapes = new Map<string, TableShape>();
    const footprints = new Map<string, TableFootprint>();
    for (const section of layout.sections) {
      if (section.kind !== "table") continue;
      shapes.set(section.id, section.shape);
      const footprint = tableFootprint(section);
      if (footprint) footprints.set(section.id, footprint);
    }
    return layoutToSeats(layout).map((p, i) => ({
      id: `${p.label}-${i}`,
      label: p.label,
      x: p.x,
      y: p.y,
      section: p.section,
      tableId: p.tableId,
      tableShape: p.tableId ? shapes.get(p.tableId) : undefined,
      tableFootprint: p.tableId ? footprints.get(p.tableId) : undefined,
    }));
  }, [params]);
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">· {seats.length} seats</span>
      </h2>
      <div className="overflow-x-auto rounded-lg border bg-muted/20 p-4">
        <RoomMap seats={seats} ariaLabel={title} />
      </div>
    </section>
  );
}

export default function RoomMapGallery() {
  return (
    <main className="mx-auto grid max-w-5xl gap-8 p-6">
      <div>
        <h1 className="text-xl font-semibold">Room layout gallery</h1>
        <p className="text-sm text-muted-foreground">
          Dev-only visual test bench — every preset rendered exactly as
          students see it at check-in.
        </p>
      </div>
      {SAMPLES.map((sample) => (
        <PresetPreview key={sample.title} {...sample} />
      ))}
    </main>
  );
}
