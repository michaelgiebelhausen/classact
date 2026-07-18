import { rowLetter } from "@/lib/seatlabels";
import type { SeatRelation } from "@/types/db";

/**
 * Room geometry (no I/O): turns a declarative RoomLayout into positioned
 * seats with structural neighbor links. Positions are in "seat units" —
 * adjacent seats in a row are 1 unit apart — with +x rightward and +y away
 * from the front of the room (the front row sits near y = 0). Renderers
 * scale units to pixels; grouping measures Euclidean distance on them.
 *
 * Neighbors are structural, not distance-derived: in-row left/right skip
 * aisle gaps, front/back align by arc-length offset so curved auditorium
 * rows link radially, and table seats link around the perimeter. The result
 * is persisted on each seat row, so check-in verification is a lookup —
 * no geometry re-derivation at request time.
 */

export type LayoutType =
  | "classroom"
  | "seminar"
  | "horseshoe"
  | "auditorium"
  | "pods";

export type TableShape = "rect" | "oval" | "ushape";

export interface RowsSection {
  id: string;
  kind: "rows";
  /** Seats per row, front row first. */
  rowSeats: number[];
  /** 0 = straight rows; 1 = strongly fanned around the front. */
  curve?: number;
  tiered?: boolean;
  /** Aisle after seat N (1-based, on the widest row; scaled to narrower rows). */
  aisles?: number[];
  /** 2 = balcony — rendered beyond a divider, no cross-level neighbors. */
  level?: 1 | 2;
  /** Row-letter offset so a balcony continues lettering after the main block. */
  rowLetterStart?: number;
}

export interface TableSection {
  id: string;
  kind: "table";
  shape: TableShape;
  seats: number;
  /** Center in seat units. Omitted = auto-placed (single table at origin). */
  cx?: number;
  cy?: number;
  /** Label prefix, e.g. "1" → seats 1A, 1B… Empty string → plain 1, 2… */
  labelPrefix: string;
}

export type LayoutSection = RowsSection | TableSection;

export interface RoomLayout {
  version: 1;
  type: LayoutType;
  sections: LayoutSection[];
  /** Seat labels toggled off in fine-tune (broken/missing seats). */
  removedSeats?: string[];
  /** The designer knobs that built this layout, for re-editing. */
  params?: Record<string, number | string | boolean>;
}

export interface SeatPlacement {
  label: string;
  x: number;
  y: number;
  section: string;
  tableId: string | null;
  /** Logical coords, kept when the seat lives in a rows section. */
  row: number | null;
  col: number | null;
  neighbors: Partial<Record<SeatRelation, string>>;
}

export const MAX_SEATS = 600;
const ROW_GAP = 1.25;
const AISLE_GAP = 0.9;
const SEAT_SPACING = 1;
const TABLE_SEAT_SPACING = 1.15;
/** Max arc-length misalignment for a front/back link between rows. */
const FRONT_BACK_TOLERANCE = 0.75;
/** Extra depth separating a balcony from the main floor. */
const BALCONY_GAP = 2.5;

// ---------------------------------------------------------------------------
// Rows sections (classroom, horseshoe, auditorium, balcony)
// ---------------------------------------------------------------------------

interface RowSeatDraft {
  label: string;
  x: number;
  y: number;
  row: number;
  col: number;
  /** Arc-length offset from the row center — aligns front/back neighbors. */
  along: number;
  rowInSection: number;
  aisleAfter: boolean;
}

/** Aisle positions for a row, scaled from widest-row numbering. */
function rowAisles(aisles: number[], rowSeats: number, maxSeats: number): Set<number> {
  const set = new Set<number>();
  for (const a of aisles) {
    const scaled = Math.round((a * rowSeats) / maxSeats);
    if (scaled >= 1 && scaled <= rowSeats - 1) set.add(scaled);
  }
  return set;
}

function rowWidth(seats: number, aisleSet: Set<number>): number {
  return (seats - 1) * SEAT_SPACING + aisleSet.size * AISLE_GAP;
}

function buildRowsSection(section: RowsSection, yOffset: number): RowSeatDraft[] {
  const { rowSeats } = section;
  const curve = Math.max(0, Math.min(1, section.curve ?? 0));
  const aisles = section.aisles ?? [];
  const maxSeats = Math.max(...rowSeats);
  const letterStart = section.rowLetterStart ?? 0;

  // Front-row geometry anchors the fan: sweep grows with `curve`.
  const frontWidth = rowWidth(rowSeats[0], rowAisles(aisles, rowSeats[0], maxSeats));
  const sweep = curve * 1.75; // radians, ~100° at full curve
  const curved = curve > 0.02 && frontWidth > 0 && sweep > 0;
  const rFront = curved ? Math.max(frontWidth / sweep, 2) : 0;

  const drafts: RowSeatDraft[] = [];
  for (let r = 0; r < rowSeats.length; r++) {
    const seats = rowSeats[r];
    const rowAisleSet = rowAisles(aisles, seats, maxSeats);
    const width = rowWidth(seats, rowAisleSet);
    let offset = 0;
    for (let c = 0; c < seats; c++) {
      if (c > 0) {
        offset += SEAT_SPACING + (rowAisleSet.has(c) ? AISLE_GAP : 0);
      }
      const along = offset - width / 2;
      let x: number;
      let y: number;
      if (curved) {
        const radius = rFront + r * ROW_GAP;
        const phi = along / radius;
        x = radius * Math.sin(phi);
        y = radius * Math.cos(phi) - rFront;
      } else {
        x = along;
        y = r * ROW_GAP;
      }
      drafts.push({
        label: `${rowLetter(letterStart + r)}${c + 1}`,
        x,
        y: y + yOffset,
        row: letterStart + r,
        col: c,
        along,
        rowInSection: r,
        aisleAfter: rowAisleSet.has(c + 1),
      });
    }
  }
  return drafts;
}

function linkRowsSection(drafts: RowSeatDraft[], neighbors: NeighborMap) {
  const byRow = new Map<number, RowSeatDraft[]>();
  for (const d of drafts) {
    const list = byRow.get(d.rowInSection) ?? [];
    list.push(d);
    byRow.set(d.rowInSection, list);
  }
  for (const [r, rowList] of byRow) {
    rowList.sort((a, b) => a.col - b.col);
    // Left/right along the row, blocked by aisles.
    for (let i = 0; i < rowList.length - 1; i++) {
      if (rowList[i].aisleAfter) continue;
      link(neighbors, rowList[i].label, "right", rowList[i + 1].label);
      link(neighbors, rowList[i + 1].label, "left", rowList[i].label);
    }
    // Front/back: nearest arc-length match in the adjacent row behind.
    const backRow = byRow.get(r + 1);
    if (!backRow) continue;
    for (const seat of rowList) {
      let best: RowSeatDraft | null = null;
      let bestDist = Infinity;
      for (const cand of backRow) {
        const dist = Math.abs(cand.along - seat.along);
        if (dist < bestDist) {
          bestDist = dist;
          best = cand;
        }
      }
      if (best && bestDist <= FRONT_BACK_TOLERANCE) {
        link(neighbors, seat.label, "back", best.label);
        link(neighbors, best.label, "front", seat.label);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Table sections (seminar, pods)
// ---------------------------------------------------------------------------

interface TableSeatDraft {
  label: string;
  x: number;
  y: number;
  tableId: string;
  order: number;
  closed: boolean; // closed perimeter (rect/oval) wraps; a U doesn't
}

/** Points around a table perimeter, spaced ~1 seat unit, starting at the front. */
function tablePerimeterPoints(shape: TableShape, seats: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  if (shape === "oval") {
    // Ellipse sized so the perimeter fits `seats` at comfortable spacing.
    const circumference = Math.max(seats, 3) * TABLE_SEAT_SPACING;
    const a = circumference / (2 * Math.PI * 0.845); // rx, with ry = 0.65·rx
    const b = a * 0.65;
    for (let i = 0; i < seats; i++) {
      // Start at the top (front) and go clockwise.
      const t = (i / seats) * 2 * Math.PI - Math.PI / 2;
      points.push({ x: a * Math.cos(t), y: b * Math.sin(t) });
    }
    return points;
  }
  if (shape === "rect") {
    const perimeter = Math.max(seats, 4) * TABLE_SEAT_SPACING;
    const w = perimeter * 0.3; // 1.5:1 table
    const h = perimeter * 0.2;
    // Walk clockwise from the front-left corner.
    const path = [
      { len: w, dx: 1, dy: 0, sx: -w / 2, sy: -h / 2 }, // front edge
      { len: h, dx: 0, dy: 1, sx: w / 2, sy: -h / 2 }, // right edge
      { len: w, dx: -1, dy: 0, sx: w / 2, sy: h / 2 }, // back edge
      { len: h, dx: 0, dy: -1, sx: -w / 2, sy: h / 2 }, // left edge
    ];
    const step = perimeter / seats;
    let travelled = step / 2;
    for (let i = 0; i < seats; i++) {
      let remaining = travelled;
      for (const side of path) {
        if (remaining <= side.len) {
          points.push({ x: side.sx + side.dx * remaining, y: side.sy + side.dy * remaining });
          break;
        }
        remaining -= side.len;
      }
      travelled += step;
    }
    return points;
  }
  // U-shape, open end toward the front: left leg down, base, right leg up.
  const pathLen = Math.max(seats, 3) * TABLE_SEAT_SPACING;
  const leg = pathLen * 0.35;
  const base = pathLen * 0.3;
  const segments = [
    { len: leg, dx: 0, dy: 1, sx: -base / 2, sy: -leg / 2 },
    { len: base, dx: 1, dy: 0, sx: -base / 2, sy: leg / 2 },
    { len: leg, dx: 0, dy: -1, sx: base / 2, sy: leg / 2 },
  ];
  const step = pathLen / seats;
  let travelled = step / 2;
  for (let i = 0; i < seats; i++) {
    let remaining = travelled;
    for (const seg of segments) {
      if (remaining <= seg.len) {
        points.push({ x: seg.sx + seg.dx * remaining, y: seg.sy + seg.dy * remaining });
        break;
      }
      remaining -= seg.len;
    }
    travelled += step;
  }
  return points;
}

const SEAT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function buildTableSection(section: TableSection): TableSeatDraft[] {
  const points = tablePerimeterPoints(section.shape, section.seats);
  const cx = section.cx ?? 0;
  const cy = section.cy ?? 0;
  return points.map((p, i) => ({
    label: section.labelPrefix
      ? `${section.labelPrefix}${SEAT_LETTERS[i]}`
      : `${i + 1}`,
    x: p.x + cx,
    y: p.y + cy,
    tableId: section.id,
    order: i,
    closed: section.shape !== "ushape",
  }));
}

function linkTableSection(drafts: TableSeatDraft[], neighbors: NeighborMap) {
  const n = drafts.length;
  if (n < 2) return;
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? i + 1 : drafts[i].closed ? 0 : -1;
    if (next < 0 || next === i) continue;
    link(neighbors, drafts[i].label, "right", drafts[next].label);
    link(neighbors, drafts[next].label, "left", drafts[i].label);
  }
}

// ---------------------------------------------------------------------------
// Layout → seats
// ---------------------------------------------------------------------------

type NeighborMap = Map<string, Partial<Record<SeatRelation, string>>>;

function link(map: NeighborMap, from: string, relation: SeatRelation, to: string) {
  const entry = map.get(from) ?? {};
  entry[relation] = to;
  map.set(from, entry);
}

/**
 * Compute every seat's position and neighbor links for a layout.
 * Deterministic; throws on invalid layouts (empty, too big, duplicate labels).
 */
export function layoutToSeats(layout: RoomLayout): SeatPlacement[] {
  if (!layout.sections.length) throw new Error("A room needs at least one section.");

  const neighbors: NeighborMap = new Map();
  const placements: SeatPlacement[] = [];

  // Main-floor sections place first; a balcony starts beyond the deepest point.
  const mainSections = layout.sections.filter(
    (s) => !(s.kind === "rows" && s.level === 2)
  );
  const balconySections = layout.sections.filter(
    (s): s is RowsSection => s.kind === "rows" && s.level === 2
  );

  let maxY = 0;
  for (const section of mainSections) {
    if (section.kind === "rows") {
      const drafts = buildRowsSection(section, 0);
      linkRowsSection(drafts, neighbors);
      for (const d of drafts) {
        placements.push({
          label: d.label,
          x: d.x,
          y: d.y,
          section: section.id,
          tableId: null,
          row: d.row,
          col: d.col,
          neighbors: {},
        });
        maxY = Math.max(maxY, d.y);
      }
    } else {
      const drafts = buildTableSection(section);
      linkTableSection(drafts, neighbors);
      for (const d of drafts) {
        placements.push({
          label: d.label,
          x: d.x,
          y: d.y,
          section: section.id,
          tableId: d.tableId,
          row: null,
          col: null,
          neighbors: {},
        });
        maxY = Math.max(maxY, d.y);
      }
    }
  }

  let balconyY = maxY + BALCONY_GAP;
  for (const section of balconySections) {
    const drafts = buildRowsSection(section, balconyY);
    linkRowsSection(drafts, neighbors);
    for (const d of drafts) {
      placements.push({
        label: d.label,
        x: d.x,
        y: d.y,
        section: section.id,
        tableId: null,
        row: d.row,
        col: d.col,
        neighbors: {},
      });
    }
    balconyY += section.rowSeats.length * ROW_GAP + ROW_GAP;
  }

  // Uniqueness before removals — a broken layout should fail loudly.
  const seen = new Set<string>();
  for (const p of placements) {
    if (seen.has(p.label)) {
      throw new Error(`Duplicate seat label "${p.label}" — sections overlap.`);
    }
    seen.add(p.label);
  }
  if (placements.length > MAX_SEATS) {
    throw new Error(`Rooms are limited to ${MAX_SEATS} seats.`);
  }

  // Apply fine-tune removals, then drop neighbor links into the holes.
  const removed = new Set(layout.removedSeats ?? []);
  const kept = placements.filter((p) => !removed.has(p.label));
  if (kept.length === 0) throw new Error("A room needs at least one seat.");
  for (const p of kept) {
    const links = neighbors.get(p.label) ?? {};
    const pruned: Partial<Record<SeatRelation, string>> = {};
    for (const rel of ["front", "back", "left", "right"] as SeatRelation[]) {
      const target = links[rel];
      if (target && !removed.has(target)) pruned[rel] = target;
    }
    p.neighbors = pruned;
  }

  // Normalize: shift so the layout starts at (0, 0).
  const minX = Math.min(...kept.map((p) => p.x));
  const minY = Math.min(...kept.map((p) => p.y));
  for (const p of kept) {
    p.x = round2(p.x - minX);
    p.y = round2(p.y - minY);
  }
  return kept;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Presets — the designer's knobs, each producing a full RoomLayout
// ---------------------------------------------------------------------------

export type PresetParams =
  | { type: "classroom"; rows: number; cols: number; aisleCount: number }
  | { type: "seminar"; shape: TableShape; seats: number }
  | { type: "horseshoe"; rows: number; frontSeats: number }
  | {
      type: "auditorium";
      rows: number;
      frontSeats: number;
      backSeats: number;
      aisleCount: number;
      curve: number;
      balconyRows: number;
    }
  | { type: "pods"; tables: number; seatsPerTable: number };

/** Evenly spaced aisle positions across the widest row. */
function evenAisles(maxSeats: number, count: number): number[] {
  const aisles: number[] = [];
  for (let i = 1; i <= count; i++) {
    const pos = Math.round((maxSeats * i) / (count + 1));
    if (pos >= 1 && pos <= maxSeats - 1) aisles.push(pos);
  }
  return [...new Set(aisles)];
}

/** Linear front→back interpolation of per-row seat counts. */
function interpolateRows(rows: number, front: number, back: number): number[] {
  if (rows === 1) return [front];
  return Array.from({ length: rows }, (_, r) =>
    Math.round(front + ((back - front) * r) / (rows - 1))
  );
}

export function buildLayout(params: PresetParams): RoomLayout {
  switch (params.type) {
    case "classroom": {
      const rowSeats = Array.from({ length: params.rows }, () => params.cols);
      return {
        version: 1,
        type: "classroom",
        sections: [
          {
            id: "main",
            kind: "rows",
            rowSeats,
            aisles: evenAisles(params.cols, params.aisleCount),
          },
        ],
        params: { ...params },
      };
    }
    case "seminar":
      return {
        version: 1,
        type: "seminar",
        sections: [
          {
            id: "table",
            kind: "table",
            shape: params.shape,
            seats: params.seats,
            labelPrefix: "",
          },
        ],
        params: { ...params },
      };
    case "horseshoe": {
      // Each row wraps a bit wider than the one inside it.
      const rowSeats = Array.from({ length: params.rows }, (_, r) =>
        params.frontSeats + r * 2
      );
      return {
        version: 1,
        type: "horseshoe",
        sections: [
          { id: "main", kind: "rows", rowSeats, curve: 0.85, tiered: true },
        ],
        params: { ...params },
      };
    }
    case "auditorium": {
      const rowSeats = interpolateRows(params.rows, params.frontSeats, params.backSeats);
      const sections: LayoutSection[] = [
        {
          id: "main",
          kind: "rows",
          rowSeats,
          curve: params.curve,
          tiered: true,
          aisles: evenAisles(Math.max(...rowSeats), params.aisleCount),
        },
      ];
      if (params.balconyRows > 0) {
        const balconySeats = Array.from(
          { length: params.balconyRows },
          () => params.backSeats
        );
        sections.push({
          id: "balcony",
          kind: "rows",
          rowSeats: balconySeats,
          curve: params.curve,
          tiered: true,
          aisles: evenAisles(params.backSeats, params.aisleCount),
          level: 2,
          rowLetterStart: params.rows,
        });
      }
      return { version: 1, type: "auditorium", sections, params: { ...params } };
    }
    case "pods": {
      // Pods auto-arranged on a grid, spaced by table footprint.
      const seats = params.seatsPerTable;
      const circumference = Math.max(seats, 3) * TABLE_SEAT_SPACING;
      const rx = circumference / (2 * Math.PI * 0.845);
      const cell = rx * 2 + 2;
      const tcols = Math.ceil(Math.sqrt(params.tables));
      const sections: LayoutSection[] = Array.from(
        { length: params.tables },
        (_, i) => ({
          id: `t${i + 1}`,
          kind: "table" as const,
          shape: "oval" as const,
          seats,
          labelPrefix: `${i + 1}`,
          cx: (i % tcols) * cell,
          cy: Math.floor(i / tcols) * (cell * 0.8),
        })
      );
      return { version: 1, type: "pods", sections, params: { ...params } };
    }
  }
}

/** The legacy rows × cols grid as a layout — existing rooms map onto this. */
export function gridLayout(rows: number, cols: number): RoomLayout {
  return buildLayout({ type: "classroom", rows, cols, aisleCount: 0 });
}

// ---------------------------------------------------------------------------
// Validation (server-side gate for layouts arriving from the client)
// ---------------------------------------------------------------------------

/** Structural validation with human-readable errors; null = valid. */
export function validateLayout(layout: RoomLayout): string | null {
  if (layout.version !== 1) return "Unsupported room layout version.";
  if (!Array.isArray(layout.sections) || layout.sections.length === 0) {
    return "A room needs at least one section.";
  }
  if (layout.sections.length > 40) return "Too many sections.";
  for (const s of layout.sections) {
    if (s.kind === "rows") {
      if (!Array.isArray(s.rowSeats) || s.rowSeats.length === 0) {
        return "A seating block needs at least one row.";
      }
      if (s.rowSeats.length > 40) return "Rooms are limited to 40 rows.";
      if (s.rowSeats.some((n) => !Number.isInteger(n) || n < 1 || n > 40)) {
        return "Rows are limited to 1–40 seats.";
      }
    } else if (s.kind === "table") {
      if (!Number.isInteger(s.seats) || s.seats < 2 || s.seats > 26) {
        return "Tables seat 2–26 people.";
      }
      if (!["rect", "oval", "ushape"].includes(s.shape)) {
        return "Unknown table shape.";
      }
    } else {
      return "Unknown section kind.";
    }
  }
  try {
    layoutToSeats(layout);
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid room layout.";
  }
  return null;
}
