"use client";

import { useMemo } from "react";
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
}

export interface RoomMapSeatState {
  kind: "empty" | "taken" | "verified" | "mine" | "off";
  photoUrl?: string | null;
  name?: string | null;
  pending?: boolean;
  tappable?: boolean;
}

interface Props {
  seats: RoomMapSeat[];
  /** Visual state per seat; defaults to an empty, untappable room preview. */
  stateFor?: (seat: RoomMapSeat) => RoomMapSeatState;
  onSeatTap?: (seat: RoomMapSeat) => void;
  frontLabel?: string;
  ariaLabel?: string;
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
  frontLabel = "Front of room",
  ariaLabel = "Classroom seat map",
}: Props) {
  const geo = useMemo(() => {
    if (seats.length === 0) return null;
    const minX = Math.min(...seats.map((s) => s.x));
    const maxX = Math.max(...seats.map((s) => s.x));
    const minY = Math.min(...seats.map((s) => s.y));
    const maxY = Math.max(...seats.map((s) => s.y));
    const width = (maxX - minX + PAD_L + PAD_R) * UNIT;
    const height = (maxY - minY + PAD_T + PAD_B) * UNIT;
    const px = (x: number) => (x - minX + PAD_L) * UNIT;
    const py = (y: number) => (y - minY + PAD_T) * UNIT;

    // Tables: a surface under each seat cluster.
    const tables: Array<{ cx: number; cy: number; rx: number; ry: number }> = [];
    const byTable = new Map<string, RoomMapSeat[]>();
    for (const s of seats) {
      if (!s.tableId) continue;
      const list = byTable.get(s.tableId) ?? [];
      list.push(s);
      byTable.set(s.tableId, list);
    }
    for (const members of byTable.values()) {
      const xs = members.map((m) => px(m.x));
      const ys = members.map((m) => py(m.y));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      // Inset so seats ring the table edge instead of sitting on it.
      const rx = Math.max((Math.max(...xs) - Math.min(...xs)) / 2 - SEAT * 0.35, UNIT * 0.45);
      const ry = Math.max((Math.max(...ys) - Math.min(...ys)) / 2 - SEAT * 0.35, UNIT * 0.35);
      tables.push({ cx, cy, rx, ry });
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

    return { width, height, px, py, tables, rowMarks, balconyY };
  }, [seats]);

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

        {geo.tables.map((t, i) => (
          <ellipse
            key={i}
            cx={t.cx}
            cy={t.cy}
            rx={t.rx}
            ry={t.ry}
            style={{
              fill: "var(--muted-foreground)",
              opacity: 0.1,
              stroke: "var(--border)",
              strokeWidth: 1.5,
            }}
          />
        ))}

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
        const stateLabel =
          state.kind === "mine"
            ? "yours"
            : state.kind === "taken" || state.kind === "verified"
              ? `taken by ${state.name ?? "a classmate"}`
              : state.kind === "off"
                ? "not in use"
                : "empty";
        return (
          <button
            key={seat.id}
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
                        ? "bg-card hover:border-primary hover:text-primary"
                        : "bg-card text-muted-foreground/60",
              state.pending ? "animate-pulse" : "",
            ].join(" ")}
            style={{
              left: geo.px(seat.x) - SEAT / 2,
              top: geo.py(seat.y) - SEAT / 2,
              width: SEAT,
              height: SEAT,
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
          </button>
        );
      })}
    </div>
  );
}
