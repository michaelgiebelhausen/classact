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
 *
 * Two gaps, two policies. A table edge left empty (`sideSeats`, e.g. the side
 * pushed against a wall) is furniture, not absence: the seats flanking it sit
 * around a corner from each other and stay linked, so the ring closes as long
 * as at most one of the four edges is bare. A seat removed in fine-tune
 * (`removedSeats`) is a real hole — a broken chair — and its links are pruned
 * rather than healed over.
 */

export type LayoutType =
  | "classroom"
  | "seminar"
  | "horseshoe"
  | "auditorium"
  | "pods";

export type TableShape = "rect" | "oval" | "ushape";

/**
 * Chairs on each edge of a rect table, clockwise from the front:
 * `[front, right, back, left]`. A `0` is an edge nobody sits at — the side
 * shoved against a wall. Sums to the table's seat count.
 */
export type SideSeats = [number, number, number, number];

export interface RowsSection {
  id: string;
  kind: "rows";
  /** Seats per row, front row first. */
  rowSeats: number[];
  /**
   * Per-row block sizes — the seats between aisles, left to right, front row
   * first. `[[3,2,3],[4,2,4]]` is a two-row block with two aisles that widens
   * only on the outside. Authoritative when present: every block owns its own
   * count in every row, so a room can taper unevenly instead of having one
   * row total divided proportionally. Falls back to `rowSeats` + `aisles`.
   */
  rowBlocks?: number[][];
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
  /**
   * Rect tables: seats on each short end. The rest split across the long
   * sides, and the table is drawn to fit. Omitted = spread evenly around
   * the perimeter.
   */
  endSeats?: number;
  /**
   * Rect tables: chairs per edge, clockwise from the front. Says exactly
   * which side is against the wall, where `endSeats` can only say how the
   * ends differ from the sides. Authoritative over `endSeats` when present.
   */
  sideSeats?: SideSeats;
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
  /**
   * The designer knobs that built this layout, for re-editing. Values are
   * whatever `PresetParams` holds — including per-block arrays and table
   * positions — and are re-validated by round-tripping through buildLayout.
   */
  params?: Record<string, unknown>;
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

/** Block sizes → the aisle positions they imply (aisle after seat N, 1-based). */
function aisleSetFromBlocks(blocks: number[]): Set<number> {
  const set = new Set<number>();
  let acc = 0;
  for (let i = 0; i < blocks.length - 1; i++) {
    acc += blocks[i];
    if (acc >= 1) set.add(acc);
  }
  return set;
}

/** A row's seat total split at its aisles — the legacy shape as blocks. */
function blocksFromAisleSet(seats: number, aisleSet: Set<number>): number[] {
  const blocks: number[] = [];
  let count = 0;
  for (let c = 1; c <= seats; c++) {
    count++;
    if (aisleSet.has(c) && c < seats) {
      blocks.push(count);
      count = 0;
    }
  }
  blocks.push(count);
  return blocks;
}

/**
 * Per-row blocks for a section: explicit `rowBlocks` when the designer set
 * them, otherwise the legacy proportional aisle split — so rooms saved
 * before blocks existed keep their exact geometry.
 */
export function resolveRowBlocks(section: RowsSection): number[][] {
  if (section.rowBlocks?.length) {
    return section.rowBlocks.map((blocks) => blocks.filter((n) => n > 0));
  }
  const maxSeats = Math.max(...section.rowSeats);
  const aisles = section.aisles ?? [];
  return section.rowSeats.map((seats) =>
    blocksFromAisleSet(seats, rowAisles(aisles, seats, maxSeats))
  );
}

function buildRowsSection(section: RowsSection, yOffset: number): RowSeatDraft[] {
  const rowBlocks = resolveRowBlocks(section);
  const rowTotals = rowBlocks.map((blocks) => blocks.reduce((a, b) => a + b, 0));
  const curve = Math.max(0, Math.min(1, section.curve ?? 0));
  const letterStart = section.rowLetterStart ?? 0;

  // Front-row geometry anchors the fan: sweep grows with `curve`.
  const frontWidth = rowWidth(rowTotals[0], aisleSetFromBlocks(rowBlocks[0]));
  const sweep = curve * 1.75; // radians, ~100° at full curve
  const curved = curve > 0.02 && frontWidth > 0 && sweep > 0;
  const rFront = curved ? Math.max(frontWidth / sweep, 2) : 0;

  const drafts: RowSeatDraft[] = [];
  for (let r = 0; r < rowBlocks.length; r++) {
    const seats = rowTotals[r];
    const rowAisleSet = aisleSetFromBlocks(rowBlocks[r]);
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

/** Seat offsets centered on an edge of the given length. */
function spreadAlong(count: number, length: number): number[] {
  return Array.from({ length: count }, (_, i) => ((i + 0.5) / count - 0.5) * length);
}

/** How many of a rect table's four edges actually seat someone. */
function occupiedSides(sideSeats: SideSeats): number {
  return sideSeats.filter((n) => n > 0).length;
}

/** Points around a table perimeter, spaced ~1 seat unit, starting at the front. */
function tablePerimeterPoints(
  shape: TableShape,
  seats: number,
  endSeats?: number,
  sideSeats?: SideSeats
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  if (shape === "rect" && sideSeats) {
    // Each edge seated exactly as told, so a table against a wall keeps its
    // real shape instead of spreading chairs into the side nobody can reach.
    const [front, right, back, left] = sideSeats;
    const w = Math.max(front, back, 1) * TABLE_SEAT_SPACING;
    const h = Math.max(left, right, 1) * TABLE_SEAT_SPACING;
    // Clockwise from the front edge, so perimeter neighbor links stay sane.
    for (const x of spreadAlong(front, w)) points.push({ x, y: -h / 2 });
    for (const y of spreadAlong(right, h)) points.push({ x: w / 2, y });
    for (const x of spreadAlong(back, w).reverse()) points.push({ x, y: h / 2 });
    for (const y of spreadAlong(left, h).reverse()) points.push({ x: -w / 2, y });
    return points;
  }
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
    // With `endSeats`, seat the short ends exactly and split the remainder
    // between the long sides — the arrangement a real seminar table has.
    if (endSeats !== undefined && endSeats >= 0 && seats > endSeats * 2) {
      const sides = seats - endSeats * 2;
      const front = Math.ceil(sides / 2);
      const back = sides - front;
      const w = Math.max(front, back, 1) * TABLE_SEAT_SPACING;
      const h = Math.max(endSeats, 1) * TABLE_SEAT_SPACING;
      // Clockwise from the front edge so perimeter neighbor links stay sane.
      for (const x of spreadAlong(front, w)) points.push({ x, y: -h / 2 });
      for (const y of spreadAlong(endSeats, h)) points.push({ x: w / 2, y });
      for (const x of spreadAlong(back, w).reverse()) points.push({ x, y: h / 2 });
      for (const y of spreadAlong(endSeats, h).reverse()) points.push({ x: -w / 2, y });
      return points;
    }
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

/**
 * Where a table's furniture sits relative to its seats, in seat units.
 * A renderer can normally infer the table from the ring of chairs around it,
 * but once an edge is bare the chairs bunch to one side and the guess drifts
 * off the wall. `dx`/`dy` step from the centroid of the table's seats to the
 * table's real center; `rx`/`ry` are its half-extents. Null means the seats
 * describe the table well enough on their own.
 */
export interface TableFootprint {
  dx: number;
  dy: number;
  rx: number;
  ry: number;
}

export function tableFootprint(section: TableSection): TableFootprint | null {
  const sideSeats = section.shape === "rect" ? section.sideSeats : undefined;
  if (!sideSeats) return null;
  const [front, right, back, left] = sideSeats;
  const points = tablePerimeterPoints("rect", section.seats, undefined, sideSeats);
  if (points.length === 0) return null;
  const meanX = points.reduce((a, p) => a + p.x, 0) / points.length;
  const meanY = points.reduce((a, p) => a + p.y, 0) / points.length;
  return {
    // Points are measured from the table's center, so stepping back by the
    // seat centroid is exactly the correction a renderer needs.
    dx: round2(-meanX),
    dy: round2(-meanY),
    rx: round2((Math.max(front, back, 1) * TABLE_SEAT_SPACING) / 2),
    ry: round2((Math.max(left, right, 1) * TABLE_SEAT_SPACING) / 2),
  };
}

const SEAT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function buildTableSection(section: TableSection): TableSeatDraft[] {
  const sideSeats = section.shape === "rect" ? section.sideSeats : undefined;
  const points = tablePerimeterPoints(
    section.shape,
    section.seats,
    section.endSeats,
    sideSeats
  );
  const cx = section.cx ?? 0;
  const cy = section.cy ?? 0;
  // A U never wraps. A rect with a bare edge still wraps while three sides
  // are seated — the pair flanking the wall are around a corner from each
  // other. Strip it to two edges or one and it's a bench, so leave it open.
  const closed =
    section.shape === "ushape"
      ? false
      : sideSeats
        ? occupiedSides(sideSeats) >= 3
        : true;
  return points.map((p, i) => ({
    label: section.labelPrefix
      ? `${section.labelPrefix}${SEAT_LETTERS[i]}`
      : `${i + 1}`,
    x: p.x + cx,
    y: p.y + cy,
    tableId: section.id,
    order: i,
    closed,
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

/** One aisle-separated column of seats, sized independently front to back. */
export interface BlockSpec {
  front: number;
  back: number;
  /**
   * Seats in each row, front row first — for rooms that step rather than
   * taper (four rows of 8, then four of 9). Authoritative over the
   * front/back interpolation when present; resized to fit the row count.
   */
  rows?: number[];
}

/**
 * One pod in a tables room. `n` is the number students read on their seat
 * labels (`3A`, `3B`…) and survives its neighbors being deleted, so removing
 * a table never renumbers anyone else's chair.
 */
export interface PodSpec {
  n: number;
  /** Center in seat units. */
  x: number;
  y: number;
  /** Overrides the room-wide seats-per-table. */
  seats?: number;
  /** Overrides the room-wide table shape. */
  shape?: TableShape;
  /** Rect pods: chairs per edge — how a table against a wall is described. */
  sideSeats?: SideSeats;
}

export type PresetParams =
  | {
      type: "classroom";
      rows: number;
      cols: number;
      aisleCount: number;
      /** Per-block seat counts. Overrides cols/aisleCount when present. */
      blocks?: BlockSpec[];
    }
  | { type: "seminar"; shape: TableShape; seats: number; endSeats?: number }
  | {
      type: "horseshoe";
      rows: number;
      frontSeats: number;
      backSeats?: number;
      /** Single block, kept in step with frontSeats/backSeats by the designer. */
      blocks?: BlockSpec[];
    }
  | {
      type: "auditorium";
      rows: number;
      frontSeats: number;
      backSeats: number;
      aisleCount: number;
      curve: number;
      balconyRows: number;
      /** Per-block front/back counts. Overrides frontSeats/backSeats/aisleCount. */
      blocks?: BlockSpec[];
    }
  | {
      type: "pods";
      tables: number;
      seatsPerTable: number;
      shape?: TableShape;
      /** Per-table centers in seat units; index-aligned with table order. */
      positions?: Array<{ x: number; y: number }>;
      /**
       * Per-table placement and overrides, authoritative when present.
       * Materialized from tables/positions the first time the professor
       * touches a pod, after which table numbers are stable.
       */
      podList?: PodSpec[];
    };

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

/** Grid pitch for auto-placed pods — one table's footprint plus breathing room. */
export function podCellSize(seatsPerTable: number): number {
  const circumference = Math.max(seatsPerTable, 3) * TABLE_SEAT_SPACING;
  const rx = circumference / (2 * Math.PI * 0.845);
  return rx * 2 + 2;
}

/**
 * Split a total into exactly `parts` blocks, using the same rounding as
 * `evenAisles` so a block split matches where the legacy aisles fell.
 * Never returns an empty block — `parts` is capped at `total`.
 */
export function splitTotal(total: number, parts: number): number[] {
  // Always exactly `parts` entries, so a front and back split zip cleanly.
  // A zero is legitimate: a narrow front row can have nothing in a block
  // that fills in further back; empty blocks drop out row by row.
  const n = Math.max(1, parts);
  const out: number[] = [];
  let placed = 0;
  for (let i = 1; i <= n; i++) {
    const target = Math.round((total * i) / n);
    out.push(target - placed);
    placed = target;
  }
  return out;
}

/** Split a row total at its aisles — the block sizes the legacy knobs imply. */
export function defaultBlocks(total: number, aisleCount: number): number[] {
  return splitTotal(total, aisleCount + 1);
}

/**
 * The per-block front/back counts a preset is currently drawing — what the
 * designer's block editors show. Derived from the simple knobs until the
 * professor edits a block, after which `params.blocks` is authoritative.
 */
export function blocksForParams(params: PresetParams): BlockSpec[] {
  if (params.type === "classroom") {
    if (params.blocks?.length) return params.blocks;
    return defaultBlocks(params.cols, params.aisleCount).map((n) => ({
      front: n,
      back: n,
    }));
  }
  if (params.type === "auditorium") {
    if (params.blocks?.length) return params.blocks;
    // Derive from the geometry the legacy knobs actually draw: interpolate
    // the row totals, then split the front and back rows into the SAME
    // number of blocks so the two lists always zip cleanly.
    const rowSeats = interpolateRows(params.rows, params.frontSeats, params.backSeats);
    const parts = params.aisleCount + 1;
    const front = splitTotal(rowSeats[0], parts);
    const back = splitTotal(rowSeats[rowSeats.length - 1], parts);
    return Array.from({ length: parts }, (_, i) => ({
      front: front[i] ?? 0,
      back: back[i] ?? 0,
    })).filter((b) => b.front > 0 || b.back > 0);
  }
  if (params.type === "horseshoe") {
    if (params.blocks?.length) return params.blocks;
    return [
      {
        front: params.frontSeats,
        back: params.backSeats ?? params.frontSeats + (params.rows - 1) * 2,
      },
    ];
  }
  return [];
}

/**
 * Stretch or trim an explicit per-row list to a row count, repeating the back
 * row when the room grows — so adding a row to a stepped block extends the
 * step instead of throwing the professor's numbers away.
 */
export function resizeRowWidths(widths: number[], rows: number): number[] {
  if (rows <= 0) return [];
  const last = widths[widths.length - 1] ?? 0;
  return Array.from({ length: rows }, (_, r) => widths[r] ?? last);
}

/** What a block seats in each row: its explicit list, or the front→back ramp. */
export function blockRowWidths(block: BlockSpec, rows: number): number[] {
  if (block.rows?.length) {
    return resizeRowWidths(
      block.rows.map((n) => Math.max(0, Math.round(n))),
      rows
    );
  }
  return interpolateRows(rows, block.front, block.back);
}

/** Rows × blocks grid: each block sized independently, row by row. */
function blocksToRowBlocks(rows: number, blocks: BlockSpec[]): number[][] {
  const perBlock = blocks.map((b) => blockRowWidths(b, rows));
  return Array.from({ length: rows }, (_, r) =>
    perBlock.map((counts) => Math.max(0, counts[r])).filter((n) => n > 0)
  );
}

/**
 * Every pod in a tables room, with stable numbers. Falls back to the legacy
 * auto-grid when the professor hasn't touched a table yet, so a room saved
 * before per-pod editing rebuilds to exactly the same seats.
 */
export function podsFromParams(params: PresetParams): PodSpec[] {
  if (params.type !== "pods") return [];
  if (params.podList?.length) return params.podList;
  const cell = podCellSize(params.seatsPerTable);
  const tcols = Math.ceil(Math.sqrt(params.tables));
  return Array.from({ length: params.tables }, (_, i) => {
    const placed = params.positions?.[i];
    return {
      n: i + 1,
      x: placed ? placed.x : (i % tcols) * cell,
      y: placed ? placed.y : Math.floor(i / tcols) * (cell * 0.8),
    };
  });
}

/** A pod's shape and seating once the room-wide defaults have been applied. */
export function resolvePod(
  pod: PodSpec,
  defaults: { seats: number; shape: TableShape }
): { shape: TableShape; seats: number; sideSeats?: SideSeats } {
  const shape = pod.shape ?? defaults.shape;
  // Edge seating only means anything on a rectangle; a round table that once
  // had it keeps the numbers dormant in case the professor switches back.
  const sideSeats = shape === "rect" ? pod.sideSeats : undefined;
  const seats = sideSeats
    ? sideSeats.reduce((a, b) => a + b, 0)
    : (pod.seats ?? defaults.seats);
  return { shape, seats, sideSeats };
}

export function buildLayout(params: PresetParams): RoomLayout {
  switch (params.type) {
    case "classroom": {
      // Untouched blocks → the exact legacy geometry, so a stored room
      // re-renders byte-identically. Edited blocks → explicit per-block sizes.
      if (!params.blocks?.length) {
        return {
          version: 1,
          type: "classroom",
          sections: [
            {
              id: "main",
              kind: "rows",
              rowSeats: Array.from({ length: params.rows }, () => params.cols),
              aisles: evenAisles(params.cols, params.aisleCount),
            },
          ],
          params: { ...params },
        };
      }
      const rowBlocks = blocksToRowBlocks(params.rows, params.blocks);
      return {
        version: 1,
        type: "classroom",
        sections: [
          {
            id: "main",
            kind: "rows",
            rowSeats: rowBlocks.map((b) => b.reduce((a, c) => a + c, 0)),
            rowBlocks,
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
            endSeats: params.shape === "rect" ? params.endSeats : undefined,
            labelPrefix: "",
          },
        ],
        params: { ...params },
      };
    case "horseshoe": {
      // Each row wraps wider than the one inside it; the professor can say
      // exactly how much wider by naming the back row. Blocks (when edited)
      // are authoritative — otherwise the legacy +2-per-row wrap.
      const rowBlocks = blocksToRowBlocks(params.rows, blocksForParams(params));
      const rowSeats =
        params.blocks?.length || params.backSeats !== undefined
          ? rowBlocks.map((b) => b.reduce((a, c) => a + c, 0))
          : Array.from({ length: params.rows }, (_, r) => params.frontSeats + r * 2);
      return {
        version: 1,
        type: "horseshoe",
        sections: [
          {
            id: "main",
            kind: "rows",
            rowSeats,
            rowBlocks:
              params.blocks?.length || params.backSeats !== undefined
                ? rowBlocks
                : undefined,
            curve: 0.85,
            tiered: true,
          },
        ],
        params: { ...params },
      };
    }
    case "auditorium": {
      // Untouched blocks → the exact legacy geometry (one interpolated row
      // total, aisles scaled per row). Rounding each block separately and
      // summing would quietly reshape every auditorium saved before blocks
      // existed — and those seats' neighbors are what check-in verifies.
      if (!params.blocks?.length) {
        const rowSeats = interpolateRows(
          params.rows,
          params.frontSeats,
          params.backSeats
        );
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
          sections.push({
            id: "balcony",
            kind: "rows",
            rowSeats: Array.from(
              { length: params.balconyRows },
              () => params.backSeats
            ),
            curve: params.curve,
            tiered: true,
            aisles: evenAisles(params.backSeats, params.aisleCount),
            level: 2,
            rowLetterStart: params.rows,
          });
        }
        return { version: 1, type: "auditorium", sections, params: { ...params } };
      }

      const blocks = params.blocks;
      const rowBlocks = blocksToRowBlocks(params.rows, blocks);
      const sections: LayoutSection[] = [
        {
          id: "main",
          kind: "rows",
          rowSeats: rowBlocks.map((b) => b.reduce((a, c) => a + c, 0)),
          rowBlocks,
          curve: params.curve,
          tiered: true,
        },
      ];
      if (params.balconyRows > 0) {
        // The balcony repeats the back row's shape, block for block.
        const balconyRow = blocks
          .map((b) => blockRowWidths(b, params.rows)[params.rows - 1] ?? 0)
          .filter((n) => n > 0);
        const balconyBlocks = Array.from(
          { length: params.balconyRows },
          () => [...balconyRow]
        );
        sections.push({
          id: "balcony",
          kind: "rows",
          rowSeats: balconyBlocks.map((b) => b.reduce((a, c) => a + c, 0)),
          rowBlocks: balconyBlocks,
          curve: params.curve,
          tiered: true,
          level: 2,
          rowLetterStart: params.rows,
        });
      }
      return { version: 1, type: "auditorium", sections, params: { ...params } };
    }
    case "pods": {
      // Auto-arranged on a grid until the professor touches a table; then
      // the pod list wins, table by table, each keeping its own number.
      const defaults = {
        seats: params.seatsPerTable,
        shape: params.shape ?? ("oval" as TableShape),
      };
      const sections: LayoutSection[] = podsFromParams(params).map((pod) => {
        const { shape, seats, sideSeats } = resolvePod(pod, defaults);
        return {
          id: `t${pod.n}`,
          kind: "table" as const,
          shape,
          seats,
          sideSeats,
          labelPrefix: `${pod.n}`,
          cx: pod.x,
          cy: pod.y,
        };
      });
      return { version: 1, type: "pods", sections, params: { ...params } };
    }
  }
}

/**
 * The removals that still refer to a real seat after a reshape. Editing one
 * corner of a room used to wipe every seat the professor had marked broken;
 * now only the labels that genuinely stopped existing are dropped. If the
 * layout can't be built at all, nothing is dropped — a half-typed number
 * shouldn't cost anyone their work.
 */
export function surviveRemovals(
  layout: RoomLayout,
  removed: Iterable<string>
): string[] {
  const wanted = [...new Set(removed)];
  if (wanted.length === 0) return [];
  try {
    const labels = new Set(
      layoutToSeats({ ...layout, removedSeats: [] }).map((p) => p.label)
    );
    return wanted.filter((label) => labels.has(label));
  } catch {
    return wanted;
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
      // Unbounded/huge values here spin rowLetter() forever on the server.
      if (
        s.rowLetterStart !== undefined &&
        (!Number.isInteger(s.rowLetterStart) ||
          s.rowLetterStart < 0 ||
          s.rowLetterStart > 200)
      ) {
        return "Invalid row lettering.";
      }
      if (s.curve !== undefined && (!Number.isFinite(s.curve) || s.curve < 0 || s.curve > 1)) {
        return "Curve must be between 0 and 1.";
      }
      if (s.aisles && (!Array.isArray(s.aisles) || s.aisles.length > 12)) {
        return "Too many aisles.";
      }
      if (s.aisles?.some((a) => !Number.isInteger(a) || a < 0 || a > 40)) {
        return "Invalid aisle position.";
      }
      if (s.rowBlocks) {
        if (!Array.isArray(s.rowBlocks) || s.rowBlocks.length !== s.rowSeats.length) {
          return "Row sections don't line up with the rows.";
        }
        if (s.rowBlocks.some((b) => !Array.isArray(b) || b.length > 8)) {
          return "Rows are limited to 8 sections.";
        }
        if (
          s.rowBlocks.some((b) =>
            b.some((n) => !Number.isInteger(n) || n < 0 || n > 40)
          )
        ) {
          return "Each section holds 0–40 seats.";
        }
        for (let i = 0; i < s.rowBlocks.length; i++) {
          const total = s.rowBlocks[i].reduce((a, b) => a + b, 0);
          if (total !== s.rowSeats[i]) {
            return "Section seat counts don't add up to the row total.";
          }
        }
      }
    } else if (s.kind === "table") {
      if (!Number.isInteger(s.seats) || s.seats < 2 || s.seats > 26) {
        return "Tables seat 2–26 people.";
      }
      if (!["rect", "oval", "ushape"].includes(s.shape)) {
        return "Unknown table shape.";
      }
      if (s.sideSeats !== undefined) {
        if (s.shape !== "rect") {
          return "Only a rectangular table can seat each side separately.";
        }
        if (s.endSeats !== undefined) {
          return "Set a table's seats per side or per end, not both.";
        }
        if (!Array.isArray(s.sideSeats) || s.sideSeats.length !== 4) {
          return "A table has four sides.";
        }
        if (s.sideSeats.some((n) => !Number.isInteger(n) || n < 0 || n > 13)) {
          return "Each side of a table seats 0–13 people.";
        }
        if (s.sideSeats.reduce((a, b) => a + b, 0) !== s.seats) {
          return "The seats on each side don't add up to the table's total.";
        }
      }
      if (
        s.endSeats !== undefined &&
        (!Number.isInteger(s.endSeats) || s.endSeats < 0 || s.endSeats * 2 >= s.seats)
      ) {
        return "Leave at least one seat for each long side of the table.";
      }
      for (const coord of [s.cx, s.cy]) {
        if (coord !== undefined && (!Number.isFinite(coord) || Math.abs(coord) > 500)) {
          return "A table is positioned off the map.";
        }
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
