"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TableFootprint } from "@/lib/roomlayout";
import { initialsOf } from "@/lib/names";
import {
  depthScale,
  fitScale,
  flipX,
  flipY,
  offsetDirection,
} from "@/lib/mapview";

/**
 * The one seat-map renderer: professor preview, designer, and student
 * check-in all draw the room through this component, so what the professor
 * builds is exactly what students see. Furniture (front-of-room bar, tables,
 * balcony divider, row letters) is SVG; seats are positioned HTML buttons —
 * real focus rings, hover states, and avatars.
 *
 * Coordinates arrive in seat units (adjacent seats ≈ 1 apart) with +y away
 * from the front; the map scales them to a fixed px-per-unit so tap targets
 * stay finger-sized and big rooms scroll instead of shrinking.
 */

export interface RoomMapSeat {
  id: string;
  label: string;
  x: number;
  y: number;
  section: string;
  tableId: string | null;
  /** Furniture drawn under a table's seats. Defaults to an oval. */
  tableShape?: "rect" | "oval" | "ushape";
  /**
   * Where the table really sits, for tables the seats alone don't describe —
   * one shoved against a wall, with all its chairs on the other three sides.
   */
  tableFootprint?: TableFootprint;
}

export interface RoomMapSeatState {
  kind: "empty" | "taken" | "verified" | "mine" | "off";
  photoUrl?: string | null;
  name?: string | null;
  pending?: boolean;
  tappable?: boolean;
  /** Empty seats only: "you haven't sat here yet" cue (dot + tinted border). */
  highlight?: boolean;
  /** Short text under the seat (first name) — needs the `captions` map mode. */
  caption?: string;
  /** Needs attention (red ring) — e.g. the student is currently tabbed away. */
  alert?: boolean;
  /**
   * Dimmed (gray, desaturated): the student's machine went silent —
   * laptop asleep, closed, or offline. Distinct from `alert`, which means
   * "demonstrably browsing elsewhere"; callers set at most one of the two.
   */
  muted?: boolean;
  /** The cold-call pick: a big primary ring so the whole room can find them. */
  spotlight?: boolean;
  /**
   * Confirmation status ring, drawn on occupied seats (taken/verified only —
   * a student's own seat reports its status through the badge instead).
   * green = someone vouched, red = awaiting a neighbor, amber = nobody
   * adjacent to ask, denied = a neighbor says they're NOT in this seat.
   * Rings are box-shadows: radially symmetric, so the professor's flipped
   * perspective can't distort them, and drawn outside the seat box so the
   * avatar can't cover them.
   */
  ring?: "confirmed" | "unconfirmed" | "unconfirmable" | "denied";
}

interface Props {
  seats: RoomMapSeat[];
  /** Visual state per seat; defaults to an empty, untappable room preview. */
  stateFor?: (seat: RoomMapSeat) => RoomMapSeatState;
  onSeatTap?: (seat: RoomMapSeat) => void;
  /**
   * Enables drag handles on each table. Deltas arrive in seat units, so the
   * caller never needs to know the pixel scale.
   */
  onTableMove?: (tableId: string, dx: number, dy: number) => void;
  /** Adds an X on each table when set (designer only). */
  onTableRemove?: (tableId: string) => void;
  /** Adds a pencil on each table when set — opens that table's settings. */
  onTableEdit?: (tableId: string) => void;
  /** Table currently being edited, ringed so it's obvious which one. */
  activeTableId?: string | null;
  frontLabel?: string;
  ariaLabel?: string;
  /** Widen the seat pitch to make room for name captions under seats. */
  captions?: boolean;
  /**
   * Draw the room as the professor sees it: front of room at the BOTTOM,
   * nearest row largest. The student view keeps front-at-top, which is what
   * they read down into from a phone.
   */
  flipped?: boolean;
  /** Scale seats by depth. Only meaningful with `flipped`. */
  perspective?: boolean;
  /** Shrink the whole room to fit its container — projection must not scroll. */
  fit?: boolean;
  /** Mark where the professor stands, at the front, centre. */
  podium?: boolean;
  /**
   * Hovering a seated student pops a larger photo — the on-seat avatar is too
   * small to recognise a face, especially in the shrunken back rows.
   */
  photoZoom?: boolean;
  /**
   * Replaces the hover card's default content (big photo + name) with the
   * caller's own — e.g. the professor's confirm-attendance card. Only
   * rendered where `photoZoom` already pops a card; without this prop the
   * default card stands, so existing maps are untouched.
   */
  hoverContent?: (seat: RoomMapSeat, state: RoomMapSeatState) => ReactNode;
}

const UNIT = 44; // px per seat unit — tap-target sized
const SEAT = 36; // seat square
const PAD_L = 1.2;
const PAD_R = 0.7;
const PAD_T = 1.35; // room for the front-of-room bar
const PAD_B = 0.6;

const EMPTY_STATE: RoomMapSeatState = { kind: "empty", tappable: false };

export function RoomMap({
  seats,
  stateFor,
  onSeatTap,
  onTableMove,
  onTableRemove,
  onTableEdit,
  activeTableId = null,
  frontLabel = "Front of room",
  ariaLabel = "Classroom seat map",
  captions = false,
  flipped = false,
  perspective = false,
  fit = false,
  podium = false,
  photoZoom = false,
  hoverContent,
}: Props) {
  // Live pixel offset of the table being dragged, before it's committed.
  const [drag, setDrag] = useState<{
    tableId: string;
    dx: number;
    dy: number;
  } | null>(null);
  const dragOffset = (tableId: string | null | undefined) =>
    drag && tableId === drag.tableId ? drag : null;

  // `fit` needs the space actually available, which only the browser knows.
  const shell = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!fit || !shell.current) return;
    const el = shell.current;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [fit]);

  const geo = useMemo(() => {
    if (seats.length === 0) return null;
    // Caption mode widens the pitch so a first name fits under each seat.
    const hu = captions ? 58 : UNIT;
    const vu = captions ? 66 : UNIT;
    const minX = Math.min(...seats.map((s) => s.x));
    const maxX = Math.max(...seats.map((s) => s.x));
    const minY = Math.min(...seats.map((s) => s.y));
    const maxY = Math.max(...seats.map((s) => s.y));
    const width = (maxX - minX + PAD_L + PAD_R) * hu;
    const height = (maxY - minY + PAD_T + PAD_B) * vu;
    // Both axes, because turning to face the class is a rotation rather than
    // a mirror. Flipping here rather than at each call site means tables, row
    // letters and the balcony divider all turn over with the seats.
    const px = (x: number) =>
      (flipX(x, minX, maxX, flipped) - minX + PAD_L) * hu;
    const py = (y: number) =>
      (flipY(y, minY, maxY, flipped) - minY + PAD_T) * vu;

    // Tables: a surface under each seat cluster, drawn in its real shape.
    const tables: Array<{
      id: string;
      shape: "rect" | "oval" | "ushape";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
    }> = [];
    const byTable = new Map<string, RoomMapSeat[]>();
    for (const s of seats) {
      if (!s.tableId) continue;
      const list = byTable.get(s.tableId) ?? [];
      list.push(s);
      byTable.set(s.tableId, list);
    }
    for (const [id, members] of byTable) {
      const xs = members.map((m) => px(m.x));
      const ys = members.map((m) => py(m.y));
      const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      const footprint = members[0].tableFootprint;
      // Inset so seats ring the table edge instead of sitting on it.
      const inset = SEAT * 0.35;
      // A bare edge pulls every chair to one side, so the ring of seats no
      // longer straddles the table — when the layout says where the table
      // really is, believe it over the seats.
      // The footprint offset is a direction in ROOM space — "step back from
      // the seat centroid" — while xs/ys are already screen pixels. Turning
      // the room around reverses both axes, so the offset has to reverse with
      // them; added unchanged it pushes the table the wrong way by twice the
      // correction and parks it on top of the students sitting there.
      const dir = offsetDirection(flipped);
      const cx = footprint
        ? mean(xs) + dir * footprint.dx * hu
        : (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = footprint
        ? mean(ys) + dir * footprint.dy * vu
        : (Math.min(...ys) + Math.max(...ys)) / 2;
      const rx = footprint
        ? Math.max(footprint.rx * hu - inset, UNIT * 0.3)
        : Math.max((Math.max(...xs) - Math.min(...xs)) / 2 - inset, UNIT * 0.45);
      const ry = footprint
        ? Math.max(footprint.ry * vu - inset, UNIT * 0.3)
        : Math.max((Math.max(...ys) - Math.min(...ys)) / 2 - inset, UNIT * 0.35);
      tables.push({ id, shape: members[0].tableShape ?? "oval", cx, cy, rx, ry });
    }

    // Row letters: left of each lettered row (rows sections only).
    const rowMarks: Array<{ x: number; y: number; letter: string }> = [];
    const byRow = new Map<string, RoomMapSeat[]>();
    for (const s of seats) {
      if (s.tableId) continue;
      const m = /^([A-Z]+)\d+$/.exec(s.label);
      if (!m) continue;
      const key = `${s.section}:${m[1]}`;
      const list = byRow.get(key) ?? [];
      list.push(s);
      byRow.set(key, list);
    }
    for (const [key, members] of byRow) {
      // Leftmost after the flip, not lowest x: mirroring the room turns the
      // first seat in a row into the last one on screen, and the label would
      // otherwise land on top of the seats instead of beside them.
      const leftmost = members.reduce((a, b) => (px(a.x) <= px(b.x) ? a : b));
      rowMarks.push({
        x: px(leftmost.x) - SEAT / 2 - 12,
        y: py(leftmost.y),
        letter: key.split(":")[1],
      });
    }

    // Balcony divider between the main floor and balcony seats.
    let balconyY: number | null = null;
    const balcony = seats.filter((s) => s.section === "balcony");
    if (balcony.length > 0) {
      const mainMaxY = Math.max(
        ...seats.filter((s) => s.section !== "balcony").map((s) => py(s.y))
      );
      const balconyMinY = Math.min(...balcony.map((s) => py(s.y)));
      balconyY = (mainMaxY + balconyMinY) / 2;
    }

    return {
      width,
      height,
      px,
      py,
      tables,
      rowMarks,
      balconyY,
      hu,
      vu,
      minY,
      maxY,
    };
  }, [seats, captions, flipped]);

  if (!geo) return null;
  const resolveState = stateFor ?? (() => EMPTY_STATE);

  const scale = fit ? fitScale(geo.width, geo.height, box.w, box.h) : 1;

  const room = (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative mx-auto w-max"
      style={{
        width: geo.width,
        height: geo.height,
        ...(scale !== 1
          ? { transform: `scale(${scale})`, transformOrigin: "top center" }
          : {}),
      }}
    >
      <svg
        className="absolute inset-0"
        width={geo.width}
        height={geo.height}
        aria-hidden="true"
      >
        {/* Front of room — the anchor everyone orients by, and the thing a
            student misreads when they check into the wrong seat. Drawn in the
            accent colour rather than a faint grey, and moved to the bottom
            when the professor is looking out from it. */}
        {(() => {
          const barH = UNIT * 0.5;
          const barY = flipped ? geo.height - barH - UNIT * 0.12 : UNIT * 0.12;
          return (
            <>
              <rect
                x={UNIT * 0.3}
                y={barY}
                width={geo.width - UNIT * 0.6}
                height={barH}
                rx={6}
                style={{ fill: "var(--primary)", opacity: 0.16 }}
              />
              <rect
                x={UNIT * 0.3}
                y={flipped ? barY : barY + barH - 2.5}
                width={geo.width - UNIT * 0.6}
                height={2.5}
                rx={1.5}
                style={{ fill: "var(--primary)", opacity: 0.85 }}
              />
              <text
                x={geo.width / 2}
                y={barY + barH / 2}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fill: "var(--primary)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                }}
              >
                {frontLabel.toUpperCase()}
              </text>
              {/* Where the professor stands. A person at the front is a
                  stronger orientation cue than a label, because it says which
                  way the room is facing rather than naming an edge. */}
              {podium && (
                <g
                  transform={`translate(${geo.width / 2}, ${
                    flipped ? barY - UNIT * 0.42 : barY + barH + UNIT * 0.42
                  })`}
                  style={{ fill: "var(--primary)", opacity: 0.55 }}
                >
                  <circle cx={0} cy={-5} r={4.5} />
                  <path d="M -7 8 a 7 7 0 0 1 14 0 z" />
                </g>
              )}
            </>
          );
        })()}

        {geo.tables.map((t) => {
          const off = dragOffset(t.id);
          const active = t.id === activeTableId;
          const surface = {
            fill: "var(--muted-foreground)",
            opacity: active ? 0.16 : 0.1,
            stroke: active ? "var(--primary)" : "var(--border)",
            strokeWidth: active ? 2.5 : 1.5,
            ...(off
              ? { transform: `translate(${off.dx}px, ${off.dy}px)` }
              : {}),
          };
          if (t.shape === "rect") {
            return (
              <rect
                key={t.id}
                x={t.cx - t.rx}
                y={t.cy - t.ry}
                width={t.rx * 2}
                height={t.ry * 2}
                rx={6}
                style={surface}
              />
            );
          }
          if (t.shape === "ushape") {
            // Open toward the front: two legs and a base, not a filled slab.
            const thickness = Math.min(t.rx, t.ry) * 0.55;
            return (
              <path
                key={t.id}
                d={[
                  `M ${t.cx - t.rx} ${t.cy - t.ry}`,
                  `h ${thickness}`,
                  `V ${t.cy + t.ry - thickness}`,
                  `H ${t.cx + t.rx - thickness}`,
                  `V ${t.cy - t.ry}`,
                  `h ${thickness}`,
                  `V ${t.cy + t.ry}`,
                  `H ${t.cx - t.rx}`,
                  "Z",
                ].join(" ")}
                style={surface}
              />
            );
          }
          return (
            <ellipse
              key={t.id}
              cx={t.cx}
              cy={t.cy}
              rx={t.rx}
              ry={t.ry}
              style={surface}
            />
          );
        })}

        {geo.rowMarks.map((m) => (
          <text
            key={`${m.letter}-${m.y}`}
            x={m.x}
            y={m.y}
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fill: "var(--muted-foreground)",
              fontSize: 10,
              fontWeight: 600,
              opacity: 0.75,
            }}
          >
            {m.letter}
          </text>
        ))}

        {geo.balconyY !== null && (
          <g>
            <line
              x1={UNIT * 0.3}
              x2={geo.width - UNIT * 0.3}
              y1={geo.balconyY}
              y2={geo.balconyY}
              style={{ stroke: "var(--border)", strokeWidth: 2, strokeDasharray: "6 5" }}
            />
            <text
              x={geo.width / 2}
              y={geo.balconyY - 7}
              textAnchor="middle"
              style={{
                fill: "var(--muted-foreground)",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.16em",
              }}
            >
              BALCONY
            </text>
          </g>
        )}
      </svg>

      {seats.map((seat) => {
        const state = resolveState(seat);
        const tappable = Boolean(state.tappable && onSeatTap);
        // Nearer the professor = larger. Scales from the seat's centre so the
        // grid stays aligned however much each row grows or shrinks.
        const depth = perspective
          ? depthScale(seat.y, geo.minY, geo.maxY)
          : 1;
        const caption = state.caption ? (
          <span
            key={`${seat.id}-caption`}
            aria-hidden="true"
            className={[
              "pointer-events-none absolute truncate text-center text-[9px] font-medium leading-tight",
              state.alert
                ? "text-destructive"
                : state.muted
                  ? "text-muted-foreground/60"
                  : state.spotlight
                    ? "text-primary font-semibold"
                    : "text-muted-foreground",
            ].join(" ")}
            style={{
              left: geo.px(seat.x) - geo.hu / 2 + 2,
              top: geo.py(seat.y) + (SEAT / 2) * depth + 2,
              width: geo.hu - 4,
              ...(depth !== 1
                ? {
                    transform: `scale(${depth})`,
                    transformOrigin: "top center",
                  }
                : {}),
            }}
          >
            {state.caption}
          </span>
        ) : null;
        const stateLabel =
          state.kind === "mine"
            ? "yours"
            : state.kind === "taken" || state.kind === "verified"
              ? `taken by ${state.name ?? "a classmate"}`
              : state.kind === "off"
                ? "not in use"
                : state.highlight
                  ? "empty — you haven't sat here yet"
                  : "empty";
        // A seat with a hover photo card must stay hoverable (and focusable)
        // even when tapping it does nothing — the last-class map, say — and a
        // disabled button fires no pointer events at all. So zoomable seats
        // stay enabled and the CLICK is what's gated on tappable. Do not
        // "simplify" the onClick back to unconditional: that guard is what
        // keeps an enabled-but-inert seat inert.
        const zoomable = Boolean(
          photoZoom &&
            (state.kind === "taken" || state.kind === "verified") &&
            state.name
        );
        // Status rings decorate other people's occupied seats; a student's
        // own seat says "you" (primary ring) and reports its status through
        // the badge above the map instead of fighting that ring.
        const statusRing =
          state.kind === "taken" || state.kind === "verified"
            ? state.ring
            : undefined;
        const ringLabel =
          statusRing === "denied"
            ? ", reported not in this seat"
            : statusRing === "confirmed"
              ? ", confirmed present"
              : statusRing === "unconfirmed"
                ? ", checked in, not yet confirmed"
                : statusRing === "unconfirmable"
                  ? ", checked in, no neighbors to confirm them yet"
                  : "";
        // Exactly ONE ring decoration per seat, picked here rather than by
        // CSS-cascade luck. A denial is always newer information than any
        // confirmation (the DB resolves denials inside every confirm), so it
        // outranks everything; the shipped alert-beats-spotlight order stays.
        const decoration =
          statusRing === "denied"
            ? "z-10 border-red-600 ring-4 ring-red-600/80 ring-offset-1 animate-pulse shadow-lg"
            : state.alert
              ? "border-destructive ring-2 ring-destructive/70 ring-offset-1"
              : state.spotlight
                ? "z-10 border-primary ring-4 ring-primary/70 ring-offset-2 shadow-lg"
                : statusRing === "confirmed"
                  ? "ring-[3px] ring-green-500/80 ring-offset-1"
                  : statusRing === "unconfirmed"
                    ? "ring-[3px] ring-red-500/80 ring-offset-1"
                    : statusRing === "unconfirmable"
                      ? "ring-[3px] ring-amber-500/80 ring-offset-1"
                      : "";
        const seatButton = (
          <button
            type="button"
            aria-label={`Seat ${seat.label}, ${stateLabel}${ringLabel}${
              state.muted ? ", disconnected" : ""
            }${state.spotlight ? ", cold call pick" : ""}`}
            disabled={!tappable && !zoomable}
            onClick={tappable ? () => onSeatTap?.(seat) : undefined}
            className={[
              "absolute flex items-center justify-center rounded-md border text-[10px] font-medium transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
              state.kind === "mine"
                ? "z-10 border-primary bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40 ring-offset-1"
                : state.kind === "verified"
                  ? "border-transparent bg-muted-foreground/30"
                  : state.kind === "taken"
                    ? "border-transparent bg-muted-foreground/15"
                    : state.kind === "off"
                      ? "border-dashed border-border bg-transparent text-muted-foreground/40"
                      : tappable
                        ? state.highlight
                          ? "border-primary/40 bg-card hover:border-primary hover:text-primary"
                          : "bg-card hover:border-primary hover:text-primary"
                        : "bg-card text-muted-foreground/60",
              state.pending ? "animate-pulse" : "",
              // Dim, don't ring: a silent machine composes with the status
              // rings above (a disconnected-but-confirmed seat keeps its
              // green ring, just grayed out).
              state.muted ? "opacity-50 saturate-50" : "",
              decoration,
            ].join(" ")}
            style={{
              left: geo.px(seat.x) - SEAT / 2,
              top: geo.py(seat.y) - SEAT / 2,
              width: SEAT,
              height: SEAT,
              // Seats ride along with their table while it's being dragged,
              // and grow or shrink with their distance from the front.
              transform:
                [
                  dragOffset(seat.tableId)
                    ? `translate(${dragOffset(seat.tableId)!.dx}px, ${
                        dragOffset(seat.tableId)!.dy
                      }px)`
                    : "",
                  depth !== 1 ? `scale(${depth})` : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined,
            }}
          >
            {(state.kind === "taken" || state.kind === "verified" || state.kind === "mine") &&
            state.name ? (
              <Avatar className="h-7 w-7">
                {state.photoUrl && (
                  <AvatarImage
                    src={state.photoUrl}
                    alt={state.name}
                    loading="lazy"
                    decoding="async"
                    width={28}
                    height={28}
                  />
                )}
                <AvatarFallback className="text-[9px]">
                  {initialsOf(state.name)}
                </AvatarFallback>
              </Avatar>
            ) : (
              seat.label
            )}
            {state.kind === "empty" && state.highlight && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary/70"
              />
            )}
          </button>
        );
        // The tooltip content is portalled, so the big photo escapes the
        // overflow-hidden `fit` shell that would clip an in-place zoom.
        return (
          <Fragment key={seat.id}>
          {zoomable ? (
            <Tooltip>
              <TooltipTrigger asChild>{seatButton}</TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="flex-col p-2">
                {hoverContent ? (
                  hoverContent(seat, state)
                ) : (
                  <>
                    <Avatar className="h-24 w-24">
                      {state.photoUrl && (
                        <AvatarImage src={state.photoUrl} alt={state.name ?? ""} />
                      )}
                      <AvatarFallback className="text-2xl">
                        {initialsOf(state.name ?? "")}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs font-medium">{state.name}</span>
                  </>
                )}
              </TooltipContent>
            </Tooltip>
          ) : (
            seatButton
          )}
          {caption}
          </Fragment>
        );
      })}

      {/* Designer-only: drag to reposition, pencil to set up, X to remove. */}
      {(onTableMove || onTableRemove || onTableEdit) &&
        geo.tables.map((t) => (
          <div
            key={`handle-${t.id}`}
            className="absolute z-20 flex items-center gap-1"
            style={{
              left: t.cx,
              top: t.cy,
              transform: `translate(-50%, -50%) translate(${
                dragOffset(t.id)?.dx ?? 0
              }px, ${dragOffset(t.id)?.dy ?? 0}px)`,
            }}
          >
            {onTableMove && (
              <button
                type="button"
                aria-label={`Move table ${t.id}. Arrow keys nudge it.`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const target = e.currentTarget;
                  // The whole drag is local: the parent hears one committed
                  // delta on release. Reporting each increment instead would
                  // re-render the map mid-drag (restarting this listener) and
                  // re-anchor the layout under the cursor.
                  const onMove = (ev: PointerEvent) => {
                    setDrag({
                      tableId: t.id,
                      dx: ev.clientX - startX,
                      dy: ev.clientY - startY,
                    });
                  };
                  const finish = (ev: PointerEvent) => {
                    target.removeEventListener("pointermove", onMove);
                    target.removeEventListener("pointerup", finish);
                    target.removeEventListener("pointercancel", finish);
                    if (target.hasPointerCapture(ev.pointerId)) {
                      target.releasePointerCapture(ev.pointerId);
                    }
                    setDrag(null);
                    const dx = (ev.clientX - startX) / geo.hu;
                    const dy = (ev.clientY - startY) / geo.vu;
                    if (dx !== 0 || dy !== 0) onTableMove(t.id, dx, dy);
                  };
                  target.addEventListener("pointermove", onMove);
                  target.addEventListener("pointerup", finish);
                  target.addEventListener("pointercancel", finish);
                }}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 1 : 0.5;
                  const nudge: Record<string, [number, number]> = {
                    ArrowLeft: [-step, 0],
                    ArrowRight: [step, 0],
                    ArrowUp: [0, -step],
                    ArrowDown: [0, step],
                  };
                  const delta = nudge[e.key];
                  if (!delta) return;
                  e.preventDefault();
                  onTableMove(t.id, delta[0], delta[1]);
                }}
                className="cursor-grab touch-none rounded-full border bg-background/90 px-2 py-1 text-[10px] font-medium shadow-sm backdrop-blur active:cursor-grabbing"
              >
                ✥ drag
              </button>
            )}
            {onTableEdit && (
              <button
                type="button"
                aria-label={`Set up table ${t.id}`}
                aria-pressed={t.id === activeTableId}
                onClick={() => onTableEdit(t.id)}
                className={[
                  "rounded-full border px-1.5 py-1 text-[10px] font-medium shadow-sm backdrop-blur",
                  t.id === activeTableId
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background/90 hover:border-primary hover:text-primary",
                ].join(" ")}
              >
                ✎
              </button>
            )}
            {onTableRemove && (
              <button
                type="button"
                aria-label={`Remove table ${t.id}`}
                onClick={() => onTableRemove(t.id)}
                className="rounded-full border bg-background/90 px-1.5 py-1 text-[10px] font-semibold text-destructive shadow-sm backdrop-blur hover:bg-destructive hover:text-destructive-foreground"
              >
                ✕
              </button>
            )}
          </div>
        ))}
    </div>
  );

  // Provider is context-only (no DOM). A short delay keeps the photo cards
  // from flickering while the mouse crosses the room; skipDelay makes
  // sweeping seat-to-seat feel instant after the first hover.
  const wrapped = (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      {room}
    </TooltipProvider>
  );

  if (!fit) return wrapped;

  // The shell owns the available space; the room scales down inside it.
  //
  // Its height is set explicitly to the SCALED height because `transform:
  // scale()` doesn't reflow — a room shrunk to 60% would otherwise keep
  // reserving 100% of its original height and leave a gaping band of empty
  // space under the map, which on a projector reads as a broken page.
  return (
    <div
      ref={shell}
      className="w-full overflow-hidden"
      style={scale !== 1 ? { height: geo.height * scale } : undefined}
    >
      {wrapped}
    </div>
  );
}
