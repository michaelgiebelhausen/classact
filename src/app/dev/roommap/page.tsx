"use client";

import { useMemo, useState } from "react";
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
 * Professor mode seats a mock roster so hover photo-zoom and the random
 * student picker can be exercised without a live class.
 */

const FIRST = ["Ava", "Ben", "Cody", "Dana", "Eli", "Farah", "Gus", "Hana", "Ivan", "Jade", "Kofi", "Lena", "Mia", "Noor", "Omar", "Priya"];
const LAST = ["Adams", "Baker", "Chen", "Diaz", "Evans", "Ford", "Gray", "Hill", "Iqbal", "Jones", "Khan", "Lopez", "Mason", "Ng", "Ortiz", "Patel"];

function mockName(i: number): string {
  return `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
}

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

function PresetPreview({
  title,
  params,
  professor,
}: {
  title: string;
  params: PresetParams;
  professor: boolean;
}) {
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
  // Mock roster: roughly two thirds of seats occupied, deterministic per
  // preset so reloads look the same. Names only — the initials fallback is
  // exactly what a student without a photo renders.
  const occupied = useMemo(() => {
    const m = new Map<string, string>();
    seats.forEach((s, i) => {
      if (i % 3 !== 0) m.set(s.id, mockName(i));
    });
    return m;
  }, [seats]);
  const [spotlightSeatId, setSpotlightSeatId] = useState<string | null>(null);
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">· {seats.length} seats</span>
      </h2>
      <div
        className={
          professor
            ? "relative rounded-lg border bg-muted/20 p-4"
            : "overflow-x-auto rounded-lg border bg-muted/20 p-4"
        }
        // minHeight, not height: a fixed 420 let a tall fitted room bleed
        // under the NEXT card's transparent SVG, which then swallowed hovers
        // on the front rows. Production containers auto-size, so this was a
        // bench-only artifact.
        style={professor ? { minHeight: 420 } : undefined}
      >
        {professor && (
          <button
            type="button"
            className="absolute right-2 top-2 z-30 rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-sm hover:border-primary hover:text-primary"
            onClick={() => {
              const ids = Array.from(occupied.keys());
              if (ids.length === 0) return;
              setSpotlightSeatId(ids[Math.floor(Math.random() * ids.length)]);
            }}
          >
            Random student
          </button>
        )}
        <RoomMap
          seats={seats}
          ariaLabel={title}
          captions={professor}
          flipped={professor}
          perspective={professor}
          fit={professor}
          photoZoom={professor}
          podium
          frontLabel={professor ? "You are here — front of room" : "Front of room"}
          onSeatTap={professor ? () => {} : undefined}
          stateFor={
            professor
              ? (seat) => {
                  const name = occupied.get(seat.id);
                  if (!name) return { kind: "empty", tappable: false };
                  const kind = name.length % 2 === 0 ? "verified" : "taken";
                  // Confirmation rings, distributed deterministically so
                  // every state is visible on every preset: mostly green and
                  // red, an occasional amber, one-in-ten pulsing denied —
                  // roughly the mix a real arrival window produces.
                  const roll = (name.charCodeAt(0) + name.length) % 10;
                  const ring =
                    roll < 4
                      ? ("confirmed" as const)
                      : roll < 7
                        ? ("unconfirmed" as const)
                        : roll < 9
                          ? ("unconfirmable" as const)
                          : ("denied" as const);
                  return {
                    kind,
                    name,
                    // "Taken" seats are tappable like the live professor map;
                    // "verified" ones are deliberately left non-tappable to
                    // exercise the LastSessionMap-style hover-only path.
                    tappable: kind === "taken",
                    caption: name.split(" ")[0],
                    spotlight: seat.id === spotlightSeatId,
                    ring,
                  };
                }
              : undefined
          }
        />
      </div>
    </section>
  );
}

export default function RoomMapGallery() {
  const [professor, setProfessor] = useState(false);
  return (
    <main className="mx-auto grid max-w-5xl gap-8 p-6">
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold">Room layout gallery</h1>
        <p className="text-sm text-muted-foreground">
          Dev-only visual test bench — every preset rendered through the real
          geometry, in either of the two ways a room gets looked at.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setProfessor(false)}
            className={`rounded-md border px-3 py-1.5 text-sm ${!professor ? "bg-primary text-primary-foreground" : ""}`}
          >
            Student view (front at top)
          </button>
          <button
            type="button"
            onClick={() => setProfessor(true)}
            className={`rounded-md border px-3 py-1.5 text-sm ${professor ? "bg-primary text-primary-foreground" : ""}`}
          >
            Professor view (front at bottom, with depth)
          </button>
        </div>
      </div>
      {SAMPLES.map((sample) => (
        <PresetPreview key={sample.title} {...sample} professor={professor} />
      ))}
    </main>
  );
}
