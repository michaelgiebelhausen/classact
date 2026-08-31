"use client";

import { useMemo, useState } from "react";
import { GripVertical, Minus, Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computeScores, displayPoints, type Band, type ScoreMode } from "@/lib/bands";

/**
 * The grading surface: the class in order, best at top, with the grade lines
 * lying between rows.
 *
 * A band is a slice of this list rather than of the score axis, which is what
 * lets the professor drag someone to a new position and have the grade follow
 * them. Rows only become draggable once peer grading is over — while it runs,
 * the order is still being refined by votes and a drag would be overwritten.
 */

export interface RankedStudent {
  submissionId: string;
  name: string;
  photoUrl: string | null;
  score: number;
  comparisons: number;
  /** True when the work was turned in after the deadline. */
  late?: boolean;
}

interface Props {
  students: RankedStudent[];
  bands: Band[];
  dividers: number[];
  scoreMode: ScoreMode;
  points: number | null;
  canReorder: boolean;
  canEditBands: boolean;
  /** Why reordering is unavailable, when it is. */
  lockedReason?: string;
  onReorder: (submissionId: string, toPosition: number) => void;
  onBandsChange: (bands: Band[], dividers: number[]) => void;
  onOpen: (submissionId: string) => void;
  openId: string | null;
}

type Drag = { kind: "row"; index: number } | { kind: "divider"; index: number };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Where a drop on a full row lands: the gap above it (cursor in the top half)
 * or the gap below it (bottom half). This turns every row into a big, forgiving
 * drop target — dropping a grade line on the *bottom half of the last student*
 * lands it below everyone, the move the thin gap-only zones made nearly
 * impossible.
 */
function dropHalf(rect: DOMRect, clientY: number, index: number): number {
  return clientY - rect.top > rect.height / 2 ? index + 1 : index;
}

/** The gap between two rows: where a dragged row or line comes to rest. */
function DropZone({
  position,
  active,
  armed,
  onOver,
  onDrop,
}: {
  position: number;
  active: boolean;
  armed: boolean;
  onOver: (position: number) => void;
  onDrop: (position: number) => void;
}) {
  return (
    <li
      aria-hidden
      onDragOver={(e) => {
        if (!armed) return;
        e.preventDefault();
        onOver(position);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(position);
      }}
      className={["h-2 rounded transition-colors", active ? "bg-primary/60" : ""].join(
        " "
      )}
    />
  );
}

/** A grade line, carrying the label and value of the band beneath it. */
function DividerRow({
  index,
  band,
  bandNumber,
  value,
  rowCount,
  points,
  editable,
  removable,
  armed,
  onDragStart,
  onDragEnd,
  onMove,
  onOverHere,
  onDropHere,
  onSetBand,
  onRemove,
}: {
  index: number;
  band: Band | undefined;
  bandNumber: number;
  value: number;
  rowCount: number;
  points: number | null;
  editable: boolean;
  removable: boolean;
  /** True while any drag is in flight — makes this line a valid drop target. */
  armed: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (index: number, to: number) => void;
  onOverHere: () => void;
  onDropHere: () => void;
  onSetBand: (patch: Partial<Band>) => void;
  onRemove: () => void;
}) {
  return (
    <li
      onDragOver={(e) => {
        if (!armed) return;
        e.preventDefault();
        onOverHere();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropHere();
      }}
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-primary/50 bg-primary/5 px-2 py-1.5"
    >
      <button
        type="button"
        draggable={editable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        disabled={!editable}
        role="slider"
        aria-label={`Grade line above ${band?.label ?? `band ${bandNumber}`}`}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={rowCount}
        onKeyDown={(e) => {
          if (!editable) return;
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onMove(index, value - 1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onMove(index, value + 1);
          }
        }}
        className="cursor-grab text-primary disabled:cursor-default disabled:opacity-50 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="text-xs text-muted-foreground">Below this line:</span>
      <Input
        value={band?.label ?? ""}
        onChange={(e) => onSetBand({ label: e.target.value || null })}
        disabled={!editable}
        placeholder="Label"
        aria-label={`Label for band ${bandNumber}`}
        className="h-7 w-28 text-sm"
      />
      <Input
        type="number"
        inputMode="decimal"
        value={band?.value ?? ""}
        onChange={(e) =>
          onSetBand({ value: e.target.value === "" ? null : Number(e.target.value) })
        }
        disabled={!editable}
        placeholder="Worth"
        aria-label={`Points for band ${bandNumber}`}
        className="h-7 w-20 text-sm"
      />
      {points !== null && (
        <span className="text-xs text-muted-foreground">of {points}</span>
      )}
      {editable && removable && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove band ${bandNumber}`}
          className="h-7 px-2"
        >
          <Minus className="size-3.5" />
        </Button>
      )}
    </li>
  );
}

export function RankedList({
  students,
  bands,
  dividers,
  scoreMode,
  points,
  canReorder,
  canEditBands,
  lockedReason,
  onReorder,
  onBandsChange,
  onOpen,
  openId,
}: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const scored = useMemo(
    () =>
      computeScores({
        order: students.map((s) => s.submissionId),
        bands,
        dividers,
        scoreMode,
        points,
      }),
    [students, bands, dividers, scoreMode, points]
  );

  function moveDivider(index: number, to: number) {
    const next = [...dividers];
    next[index] = Math.min(students.length, Math.max(0, to));
    // Lines cannot cross: pushing one past its neighbour takes them along.
    for (let i = index + 1; i < next.length; i++) {
      next[i] = Math.max(next[i], next[index]);
    }
    for (let i = index - 1; i >= 0; i--) {
      next[i] = Math.min(next[i], next[index]);
    }
    onBandsChange(bands, next);
  }

  function setBand(index: number, patch: Partial<Band>) {
    onBandsChange(
      bands.map((b, i) => (i === index ? { ...b, ...patch } : b)),
      dividers
    );
  }

  function addBand() {
    // A new band starts at the bottom of the list, worth nothing yet.
    onBandsChange(
      [...bands, { label: null, value: null }],
      [...dividers, students.length]
    );
  }

  function removeBand(index: number) {
    if (bands.length <= 1) return;
    // Drop the line that opened the removed band (the top band has none).
    const lineToDrop = index === 0 ? 0 : index - 1;
    onBandsChange(
      bands.filter((_, i) => i !== index),
      dividers.filter((_, i) => i !== lineToDrop)
    );
  }

  function handleDrop(position: number) {
    if (!drag) return;
    if (drag.kind === "row") {
      const student = students[drag.index];
      // Dropping below its own position: the list closes up behind it first.
      const to = position > drag.index ? position - 1 : position;
      if (student && to !== drag.index) onReorder(student.submissionId, to);
    } else {
      moveDivider(drag.index, position);
    }
    setDrag(null);
    setOver(null);
  }

  function endDrag() {
    setDrag(null);
    setOver(null);
  }

  /** The lines that sit immediately above row `position`. */
  function linesAt(position: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < dividers.length; i++) {
      if (dividers[i] === position) out.push(i);
    }
    return out;
  }

  function renderLines(position: number) {
    return linesAt(position).map((line) => (
      <DividerRow
        key={`line-${line}`}
        index={line}
        band={bands[line + 1]}
        bandNumber={line + 2}
        value={dividers[line]}
        rowCount={students.length}
        points={points}
        editable={canEditBands}
        removable={bands.length > 1}
        armed={drag !== null}
        onDragStart={() => setDrag({ kind: "divider", index: line })}
        onDragEnd={endDrag}
        onMove={moveDivider}
        onOverHere={() => setOver(dividers[line])}
        onDropHere={() => handleDrop(dividers[line])}
        onSetBand={(patch) => setBand(line + 1, patch)}
        onRemove={() => removeBand(line + 1)}
      />
    ));
  }

  return (
    <div className="grid gap-3">
      {/* The top band's own label and value — it has no line above it. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
        <span className="text-xs text-muted-foreground">Top band:</span>
        <Input
          value={bands[0]?.label ?? ""}
          onChange={(e) => setBand(0, { label: e.target.value || null })}
          disabled={!canEditBands}
          placeholder="Label"
          aria-label="Label for the top band"
          className="h-7 w-28 text-sm"
        />
        <Input
          type="number"
          inputMode="decimal"
          value={bands[0]?.value ?? ""}
          onChange={(e) =>
            setBand(0, { value: e.target.value === "" ? null : Number(e.target.value) })
          }
          disabled={!canEditBands}
          placeholder="Worth"
          aria-label="Points for the top band"
          className="h-7 w-20 text-sm"
        />
        {points !== null && (
          <span className="text-xs text-muted-foreground">of {points}</span>
        )}
      </div>

      {!canReorder && lockedReason && (
        <p className="text-xs text-muted-foreground">{lockedReason}</p>
      )}

      <ul className="grid gap-1">
        {students.map((student, index) => (
          <div key={student.submissionId} className="contents">
            {renderLines(index)}
            <DropZone
              position={index}
              active={over === index}
              armed={drag !== null}
              onOver={setOver}
              onDrop={handleDrop}
            />
            <li
              onDragOver={(e) => {
                if (drag) {
                  e.preventDefault();
                  setOver(
                    dropHalf(e.currentTarget.getBoundingClientRect(), e.clientY, index)
                  );
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(
                  dropHalf(e.currentTarget.getBoundingClientRect(), e.clientY, index)
                );
              }}
              className={[
                "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                drag?.kind === "row" && drag.index === index ? "opacity-50" : "",
                openId === student.submissionId ? "border-primary bg-primary/5" : "",
              ].join(" ")}
            >
              <button
                type="button"
                draggable={canReorder}
                onDragStart={() => setDrag({ kind: "row", index })}
                onDragEnd={endDrag}
                disabled={!canReorder}
                aria-label={`Reorder ${student.name}. Use arrow keys to move them.`}
                onKeyDown={(e) => {
                  if (!canReorder) return;
                  if (e.key === "ArrowUp" && index > 0) {
                    e.preventDefault();
                    onReorder(student.submissionId, index - 1);
                  } else if (e.key === "ArrowDown" && index < students.length - 1) {
                    e.preventDefault();
                    onReorder(student.submissionId, index + 1);
                  }
                }}
                className="cursor-grab text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30 active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </button>

              <span className="w-6 text-right text-sm tabular-nums text-muted-foreground">
                {index + 1}
              </span>

              <Avatar className="size-8 border border-border">
                {student.photoUrl && (
                  <AvatarImage src={student.photoUrl} alt={student.name} />
                )}
                <AvatarFallback className="text-[10px]">
                  {initials(student.name)}
                </AvatarFallback>
              </Avatar>

              <button
                type="button"
                onClick={() => onOpen(student.submissionId)}
                className="flex-1 truncate text-left text-sm font-medium hover:underline"
              >
                {student.name}
              </button>

              {student.late && (
                <Badge
                  variant="outline"
                  className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400"
                >
                  Late
                </Badge>
              )}
              {student.comparisons === 0 && (
                <Badge variant="outline" className="text-[10px]">
                  no human eyes
                </Badge>
              )}
              {scored[index]?.label && (
                <Badge variant="secondary">{scored[index].label}</Badge>
              )}
              <span className="w-14 text-right text-sm font-semibold tabular-nums">
                {displayPoints(scored[index]?.points ?? null)}
              </span>
            </li>
          </div>
        ))}
        {/* Lines can also sit below everyone — an empty bottom band. */}
        {renderLines(students.length)}
        <DropZone
          position={students.length}
          active={over === students.length}
          armed={drag !== null}
          onOver={setOver}
          onDrop={handleDrop}
        />
      </ul>

      {/* New bands land at the bottom of the list, so the button that adds
          them lives there too. */}
      {canEditBands && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addBand}
          className="w-fit"
        >
          <Plus className="mr-1 size-3.5" /> Add band
        </Button>
      )}
    </div>
  );
}
