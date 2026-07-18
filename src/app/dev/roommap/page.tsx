"use client";

import { useMemo } from "react";
import { RoomMap } from "@/components/features/rooms/RoomMap";
import { buildLayout, layoutToSeats, type PresetParams } from "@/lib/roomlayout";

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
];

function PresetPreview({ title, params }: { title: string; params: PresetParams }) {
  const seats = useMemo(
    () =>
      layoutToSeats(buildLayout(params)).map((p, i) => ({
        id: `${p.label}-${i}`,
        label: p.label,
        x: p.x,
        y: p.y,
        section: p.section,
        tableId: p.tableId,
      })),
    [params]
  );
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
