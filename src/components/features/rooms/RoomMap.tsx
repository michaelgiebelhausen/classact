"use client";

import { Fragment, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
  frontLabel?: string;
  ariaLabel?: string;
  /** Widen the seat pitch to make room for name captions under seats. */
  captions?: boolean;
}

const UNIT = 44; // px per seat unit — tap-target sized
const SEAT = 36; // seat square
const PAD_L = 1.2;
const PAD_R = 0.7;
const PAD_T = 1.35; // room for the front-of-room bar
const PAD_B = 0.6;

const EMPTY_STATE: RoomMapSeatState = { kind: "empty", tappable: false };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function RoomMap({
  seats,
  stateFor,
  onSeatTap,
  onTableMove,
  onTableRemove,
  frontLabel = "Front of room",
  ariaLabel = "Classroom seat map",
  captions = false,
}: Props) {
  // Live pixel offset of the table being dragged, before it's committed.
  const [drag, setDrag] = useState<{
    tableId: string;
    dx: number;
    dy: number;
  } | null>(null);
  const dragOffset = (tableId: string | null | undefined) =>
    drag && tableId === drag.tableId ? drag : null;

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
    const px = (x: number) => (x - minX + PAD_L) * hu;
    const py = (y: number) => (y - minY + PAD_T) * vu;

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
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      // Inset so seats ring the table edge instead of sitting on it.
      const rx = Math.max((Math.max(...xs) - Math.min(...xs)) / 2 - SEAT * 0.35, UNIT * 0.45);
      const ry = Math.max((Math.max(...ys) - Math.min(...ys)) / 2 - SEAT * 0.35, UNIT * 0.35);
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
      const leftmost = members.reduce((a, b) => (a.x <= b.x ? a : b));
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

    return { width, height, px, py, tables, rowMarks, balconyY, hu, vu };
  }, [seats, captions]);

  if (!geo) return null;
  const resolveState = stateFor ?? (() => EMPTY_STATE);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative mx-auto w-max"
      style={{ width: geo.width, height: geo.height }}
    >
      <svg
        className="absolute inset-0"
        width={geo.width}
        height={geo.height}
        aria-hidden="true"
      >
        {/* Front of room — the anchor students orient by. */}
        <rect
          x={UNIT * 0.3}
          y={UNIT * 0.12}
          width={geo.width - UNIT * 0.6}
          height={UNIT * 0.5}
          rx={6}
          style={{ fill: "var(--muted-foreground)", opacity: 0.18 }}
        />
        <text
          x={geo.width / 2}
          y={UNIT * 0.37}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fill: "var(--muted-foreground)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.18em",
          }}
        >
          {frontLabel.toUpperCase()}
        </text>

        {geo.tables.map((t) => {
          const off = dragOffset(t.id);
          const surface = {
            fill: "var(--muted-foreground)",
            opacity: 0.1,
            stroke: "var(--border)",
            strokeWidth: 1.5,
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
        const caption = state.caption ? (
          <span
            key={`${seat.id}-caption`}
            aria-hidden="true"
            className={[
              "pointer-events-none absolute truncate text-center text-[9px] font-medium leading-tight",
              state.alert ? "text-destructive" : "text-muted-foreground",
            ].join(" ")}
            style={{
              left: geo.px(seat.x) - geo.hu / 2 + 2,
              top: geo.py(seat.y) + SEAT / 2 + 2,
              width: geo.hu - 4,
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
        return (
          <Fragment key={seat.id}>
          <button
            type="button"
            aria-label={`Seat ${seat.label}, ${stateLabel}`}
            disabled={!tappable}
            onClick={() => onSeatTap?.(seat)}
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
              state.alert
                ? "border-destructive ring-2 ring-destructive/70 ring-offset-1"
                : "",
            ].join(" ")}
            style={{
              left: geo.px(seat.x) - SEAT / 2,
              top: geo.py(seat.y) - SEAT / 2,
              width: SEAT,
              height: SEAT,
              // Seats ride along with their table while it's being dragged.
              transform: dragOffset(seat.tableId)
                ? `translate(${dragOffset(seat.tableId)!.dx}px, ${
                    dragOffset(seat.tableId)!.dy
                  }px)`
                : undefined,
            }}
          >
            {(state.kind === "taken" || state.kind === "verified" || state.kind === "mine") &&
            state.name ? (
              <Avatar className="h-7 w-7">
                {state.photoUrl && <AvatarImage src={state.photoUrl} alt={state.name} />}
                <AvatarFallback className="text-[9px]">
                  {initials(state.name)}
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
          {caption}
          </Fragment>
        );
      })}

      {/* Designer-only: drag a table to reposition it, X to remove it. */}
      {(onTableMove || onTableRemove) &&
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
}
