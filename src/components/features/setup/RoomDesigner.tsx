"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RoomMap } from "@/components/features/rooms/RoomMap";
import {
  blocksForParams,
  buildLayout,
  layoutToSeats,
  podCellSize,
  type BlockSpec,
  type PresetParams,
  type RoomLayout,
  type TableShape,
} from "@/lib/roomlayout";
import {
  adoptRoom,
  draftRoomFromPhoto,
  saveRoomLayout,
  searchRooms,
  type RoomLocation,
  type RoomSearchHit,
} from "@/server/actions/rooms";

/**
 * Room setup, professor-side: name where you teach (and reuse a room a
 * colleague already mapped), or shape the room from a preset — classroom,
 * seminar table, horseshoe, auditorium, pods — with a live preview that is
 * pixel-identical to what students see at check-in.
 */

interface Props {
  courseId: string;
  hasExistingRoom: boolean;
  initialLayout: RoomLayout | null;
  initialLocation: RoomLocation | null;
  universitySuggestion: string;
}

const PRESETS: Array<{ type: PresetParams["type"]; title: string; blurb: string }> = [
  { type: "classroom", title: "Classroom", blurb: "Straight rows, flat floor" },
  { type: "seminar", title: "Seminar table", blurb: "One shared table" },
  { type: "horseshoe", title: "Horseshoe", blurb: "Curved rows, case-study style" },
  { type: "auditorium", title: "Auditorium", blurb: "Tiered, fan-shaped, aisles" },
  { type: "pods", title: "Tables / pods", blurb: "Small-group tables" },
];

function defaultParams(type: PresetParams["type"]): PresetParams {
  switch (type) {
    case "classroom":
      return { type, rows: 6, cols: 8, aisleCount: 1 };
    case "seminar":
      return { type, shape: "oval", seats: 12 };
    case "horseshoe":
      return { type, rows: 3, frontSeats: 8 };
    case "auditorium":
      return {
        type,
        rows: 10,
        frontSeats: 10,
        backSeats: 16,
        aisleCount: 2,
        curve: 0.4,
        balconyRows: 0,
      };
    case "pods":
      return { type, tables: 6, seatsPerTable: 5 };
  }
}

function paramsFromLayout(layout: RoomLayout | null): PresetParams {
  const p = layout?.params;
  if (p && typeof p.type === "string") {
    try {
      // Round-trip guard: only trust stored params that still build.
      const candidate = p as unknown as PresetParams;
      buildLayout(candidate);
      return candidate;
    } catch {
      // fall through to default
    }
  }
  return defaultParams("classroom");
}

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function RoomDesigner({
  courseId,
  hasExistingRoom,
  initialLayout,
  initialLocation,
  universitySuggestion,
}: Props) {
  const router = useRouter();

  // --- Where do you teach? ---
  const [universityName, setUniversityName] = useState(
    initialLocation?.universityName ?? universitySuggestion
  );
  const [buildingName, setBuildingName] = useState(initialLocation?.buildingName ?? "");
  const [roomNumber, setRoomNumber] = useState(initialLocation?.roomNumber ?? "");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<RoomSearchHit[] | null>(null);
  const [selectedHit, setSelectedHit] = useState<RoomSearchHit | null>(null);

  // --- Designer ---
  const [params, setParams] = useState<PresetParams>(() => paramsFromLayout(initialLayout));
  const [removedSeats, setRemovedSeats] = useState<Set<string>>(
    () => new Set(initialLayout?.removedSeats ?? [])
  );
  const [editSeats, setEditSeats] = useState(false);
  const [saving, setSaving] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [drafting, setDrafting] = useState(false);
  const [aiDrafted, setAiDrafted] = useState(false);
  const [aiNotes, setAiNotes] = useState("");
  const [confirm, setConfirm] = useState<
    null | { kind: "save" } | { kind: "adopt"; roomId: string }
  >(null);

  // Full layout (removals shown ghosted, not hidden) drives the preview.
  const previewSeats = useMemo(() => {
    const source = selectedHit ? selectedHit.layout : buildLayout(params);
    // Table shape rides along so the map draws real furniture, not always an oval.
    const shapeByTable = new Map<string, TableShape>();
    for (const s of source.sections) {
      if (s.kind === "table") shapeByTable.set(s.id, s.shape);
    }
    try {
      return layoutToSeats({ ...source, removedSeats: [] }).map((p, i) => ({
        id: `${p.label}-${i}`,
        label: p.label,
        x: p.x,
        y: p.y,
        section: p.section,
        tableId: p.tableId,
        tableShape: p.tableId ? shapeByTable.get(p.tableId) : undefined,
      }));
    } catch {
      return [];
    }
  }, [params, selectedHit]);

  const activeSeatCount = selectedHit
    ? selectedHit.capacity
    : previewSeats.filter((s) => !removedSeats.has(s.label)).length;

  function updateParams(patch: Partial<PresetParams>, keepRemovals = false) {
    setSelectedHit(null);
    // Reshaping the room invalidates seat labels, so removals are dropped —
    // but sliding a table around keeps every label intact.
    if (!keepRemovals) setRemovedSeats(new Set());
    setParams((prev) => ({ ...prev, ...patch }) as PresetParams);
  }

  // --- Column blocks: the seats between aisles, each sized on its own ---
  const blocks = useMemo(
    () => (selectedHit ? [] : blocksForParams(params)),
    [params, selectedHit]
  );
  const tiered = params.type === "auditorium" || params.type === "horseshoe";

  function setBlocks(next: BlockSpec[]) {
    const cleaned = next
      .map((b) => ({
        front: clampInt(b.front, 0, 40),
        back: clampInt(tiered ? b.back : b.front, 0, 40),
      }))
      // A block with no seats in any row isn't a section, it's nothing.
      .filter((b) => b.front > 0 || b.back > 0);
    if (cleaned.length === 0) return;
    // Horseshoe reads frontSeats/backSeats as well as blocks — keep them in
    // step so its single block stays editable.
    const patch: Partial<PresetParams> =
      params.type === "horseshoe"
        ? ({
            blocks: cleaned,
            frontSeats: cleaned[0].front,
            backSeats: cleaned[0].back,
          } as Partial<PresetParams>)
        : ({ blocks: cleaned } as Partial<PresetParams>);
    updateParams(patch);
  }

  function editBlock(index: number, patch: Partial<BlockSpec>) {
    setBlocks(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function addBlock() {
    if (blocks.length >= 8) return;
    const last = blocks[blocks.length - 1] ?? { front: 4, back: 4 };
    setBlocks([...blocks, { ...last }]);
  }

  function removeBlock(index: number) {
    if (blocks.length <= 1) return;
    setBlocks(blocks.filter((_, i) => i !== index));
  }

  // --- Pods: drag to place, X to remove ---
  const podPositions = useMemo(() => {
    if (params.type !== "pods") return [];
    const cell = podCellSize(params.seatsPerTable);
    const cols = Math.ceil(Math.sqrt(params.tables));
    return Array.from({ length: params.tables }, (_, i) => {
      const placed = params.positions?.[i];
      return placed
        ? { ...placed }
        : { x: (i % cols) * cell, y: Math.floor(i / cols) * (cell * 0.8) };
    });
  }, [params]);

  function moveTable(tableId: string, dx: number, dy: number) {
    if (params.type !== "pods") return;
    const index = Number(tableId.replace(/^t/, "")) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= podPositions.length) return;
    // One committed delta per drag, so the half-unit snap lands on the final
    // position instead of rounding each mouse increment away to nothing.
    const next = podPositions.map((p, i) =>
      i === index
        ? {
            x: Math.round(Math.max(0, p.x + dx) * 2) / 2,
            y: Math.round(Math.max(0, p.y + dy) * 2) / 2,
          }
        : p
    );
    updateParams({ positions: next } as Partial<PresetParams>, true);
  }

  function removeTable(tableId: string) {
    if (params.type !== "pods" || params.tables <= 1) return;
    const index = Number(tableId.replace(/^t/, "")) - 1;
    if (!Number.isInteger(index) || index < 0) return;
    updateParams({
      tables: params.tables - 1,
      positions: podPositions.filter((_, i) => i !== index),
    } as Partial<PresetParams>);
  }

  function addTable() {
    if (params.type !== "pods" || params.tables >= 20) return;
    const cell = podCellSize(params.seatsPerTable);
    const last = podPositions[podPositions.length - 1] ?? { x: 0, y: 0 };
    updateParams({
      tables: params.tables + 1,
      positions: [...podPositions, { x: last.x + cell, y: last.y }],
    } as Partial<PresetParams>);
  }

  function switchPreset(type: PresetParams["type"]) {
    setSelectedHit(null);
    setRemovedSeats(new Set());
    setEditSeats(false);
    setAiDrafted(false);
    setAiNotes("");
    setParams(defaultParams(type));
  }

  async function handlePhoto(file: File) {
    if (file.size > 6 * 1024 * 1024) {
      toast.error("That image is too large — keep it under ~6 MB.");
      return;
    }
    setDrafting(true);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }).catch(() => "");
    const base64 = dataUrl.split(",")[1] ?? "";
    if (!base64) {
      setDrafting(false);
      toast.error("Couldn't read that image — try another file.");
      return;
    }
    const result = await draftRoomFromPhoto(courseId, base64, file.type);
    setDrafting(false);
    if (result.ok && result.data) {
      setSelectedHit(null);
      setRemovedSeats(new Set());
      setEditSeats(false);
      setParams(result.data.params);
      setAiDrafted(true);
      setAiNotes(result.data.notes);
      toast.success("Draft ready — check it against your room, tweak, then save.");
    } else {
      toast.error(result.ok ? "Drafting failed." : result.error);
    }
  }

  async function runSearch() {
    const query = `${buildingName} ${roomNumber}`.trim();
    if (!query) {
      toast.message("Type a building or room number to search.");
      return;
    }
    setSearching(true);
    const result = await searchRooms({ universityName, query });
    setSearching(false);
    if (result.ok) {
      setHits(result.data ?? []);
      if ((result.data ?? []).length === 0) {
        toast.message("No match yet — design it below and you'll put it on the map.");
      }
    } else {
      toast.error(result.error);
    }
  }

  async function doSave(force: boolean) {
    setSaving(true);
    const layout: RoomLayout = {
      ...buildLayout(params),
      removedSeats: Array.from(removedSeats),
    };
    const location: RoomLocation | null =
      universityName.trim() && buildingName.trim() && roomNumber.trim()
        ? { universityName, buildingName, roomNumber }
        : null;
    const result = await saveRoomLayout(courseId, layout, location, force, aiDrafted);
    setSaving(false);
    if (result.ok) {
      toast.success(
        `Room saved — ${result.data?.seatCount} seats${
          location ? ` · ${location.buildingName} ${location.roomNumber}` : ""
        }.`
      );
      setConfirm(null);
      router.refresh();
    } else if (result.error.includes("Confirm to continue")) {
      setConfirm({ kind: "save" });
    } else {
      toast.error(result.error);
    }
  }

  async function doAdopt(roomId: string, force: boolean) {
    setSaving(true);
    const result = await adoptRoom(courseId, roomId, force);
    setSaving(false);
    if (result.ok) {
      toast.success(`Room adopted — ${result.data?.seatCount} seats, ready for check-in.`);
      setConfirm(null);
      setSelectedHit(null);
      router.refresh();
    } else if (result.error.includes("Confirm to continue")) {
      setConfirm({ kind: "adopt", roomId });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Where do you teach?</CardTitle>
          <CardDescription>
            If a colleague already mapped your room, you can use it as-is —
            otherwise your design goes into the shared room database for the
            next professor.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2">
              <Label htmlFor="university">University</Label>
              <Input
                id="university"
                value={universityName}
                onChange={(e) => setUniversityName(e.target.value)}
                placeholder="State University"
                className="w-56"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="building">Building</Label>
              <Input
                id="building"
                value={buildingName}
                onChange={(e) => setBuildingName(e.target.value)}
                placeholder="Armstrong Hall"
                className="w-48"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="roomNumber">Room</Label>
              <Input
                id="roomNumber"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder="1010"
                className="w-24"
              />
            </div>
            <Button variant="outline" onClick={runSearch} disabled={searching}>
              {searching ? "Searching…" : "Find my room"}
            </Button>
          </div>

          {hits && hits.length > 0 && (
            <div className="grid gap-2">
              {hits.map((hit) => (
                <div
                  key={hit.roomId}
                  className={[
                    "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3",
                    selectedHit?.roomId === hit.roomId ? "border-primary" : "",
                  ].join(" ")}
                >
                  <div className="text-sm">
                    <span className="font-medium">
                      {hit.buildingName} {hit.roomNumber}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {hit.universityName} · {hit.capacity} seats · {hit.layoutType}
                    </span>{" "}
                    {hit.verified && <Badge variant="secondary">Verified</Badge>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelectedHit(selectedHit?.roomId === hit.roomId ? null : hit)
                      }
                    >
                      {selectedHit?.roomId === hit.roomId ? "Hide preview" : "Preview"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => doAdopt(hit.roomId, false)}
                      disabled={saving}
                    >
                      Use this room
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selectedHit ? "Room preview" : "Design the room"}</CardTitle>
          <CardDescription>
            {selectedHit
              ? `${selectedHit.buildingName} ${selectedHit.roomNumber} — exactly what your students will see.`
              : "Pick the shape that matches your room, then fine-tune. The preview is exactly what students see at check-in."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {!selectedHit && (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3">
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePhoto(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => photoRef.current?.click()}
                  disabled={drafting}
                >
                  {drafting ? "Reading your room…" : "Upload a photo of your room"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  AI drafts the layout — you review and tweak before saving.
                </span>
              </div>
              {aiDrafted && aiNotes && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <span className="font-medium">AI draft notes:</span> {aiNotes}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.type}
                    type="button"
                    onClick={() => switchPreset(preset.type)}
                    className={[
                      "rounded-lg border p-3 text-left transition-colors hover:border-primary",
                      params.type === preset.type ? "border-primary bg-primary/5" : "",
                    ].join(" ")}
                  >
                    <span className="block text-sm font-medium">{preset.title}</span>
                    <span className="block text-xs text-muted-foreground">{preset.blurb}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-4">
                {params.type === "classroom" && (
                  <Knob label="Rows" value={params.rows} min={1} max={40}
                    onChange={(v) => updateParams({ rows: v })} />
                )}
                {params.type === "seminar" && (
                  <>
                    <div className="grid gap-2">
                      <Label>Table shape</Label>
                      <div className="flex gap-1">
                        {(["oval", "rect", "ushape"] as TableShape[]).map((shape) => (
                          <Button
                            key={shape}
                            type="button"
                            size="sm"
                            variant={params.shape === shape ? "default" : "outline"}
                            onClick={() => updateParams({ shape })}
                          >
                            {shape === "oval" ? "Oval" : shape === "rect" ? "Rectangle" : "U-shape"}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <Knob
                      label="Seats"
                      value={params.seats}
                      min={2}
                      max={26}
                      onChange={(v) => {
                        // Shrinking the table can strand an end count that
                        // leaves no seats for the long sides — save would
                        // reject a preview that looked fine.
                        const maxEnds = Math.max(0, Math.floor((v - 2) / 2));
                        const ends =
                          params.endSeats === undefined
                            ? undefined
                            : Math.min(params.endSeats, maxEnds);
                        updateParams({ seats: v, endSeats: ends });
                      }}
                    />
                    {params.shape === "rect" && (
                      <Knob
                        label="Seats on each end"
                        value={params.endSeats ?? 1}
                        min={0}
                        max={Math.max(0, Math.floor((params.seats - 2) / 2))}
                        onChange={(v) => updateParams({ endSeats: v })}
                      />
                    )}
                  </>
                )}
                {params.type === "horseshoe" && (
                  <Knob label="Rows" value={params.rows} min={1} max={6}
                    onChange={(v) => updateParams({ rows: v })} />
                )}
                {params.type === "auditorium" && (
                  <>
                    <Knob label="Rows" value={params.rows} min={2} max={40}
                      onChange={(v) => updateParams({ rows: v })} />
                    <div className="grid gap-2">
                      <Label htmlFor="curve">Curve</Label>
                      <input
                        id="curve"
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(params.curve * 100)}
                        onChange={(e) =>
                          updateParams({ curve: Number(e.target.value) / 100 })
                        }
                        className="w-32 accent-primary"
                      />
                    </div>
                    <Knob label="Balcony rows" value={params.balconyRows} min={0} max={5}
                      onChange={(v) => updateParams({ balconyRows: v })} />
                  </>
                )}
                {params.type === "pods" && (
                  <>
                    <Knob label="Seats per table" value={params.seatsPerTable} min={2} max={10}
                      onChange={(v) => updateParams({ seatsPerTable: v })} />
                    <div className="grid gap-2">
                      <Label>Table shape</Label>
                      <div className="flex gap-1">
                        {(["oval", "rect"] as TableShape[]).map((shape) => (
                          <Button
                            key={shape}
                            type="button"
                            size="sm"
                            variant={(params.shape ?? "oval") === shape ? "default" : "outline"}
                            onClick={() => updateParams({ shape })}
                          >
                            {shape === "oval" ? "Round" : "Rectangle"}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>Tables</Label>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={addTable}>
                          + Add table
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          {params.tables} · drag to arrange
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Blocks sit above the seats they control, in the same order. */}
              {blocks.length > 0 && (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label>
                      {blocks.length === 1
                        ? "Seats per row"
                        : "Seat sections (split by aisles)"}
                    </Label>
                    {params.type !== "horseshoe" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={addBlock}
                          disabled={blocks.length >= 8}
                        >
                          + Add aisle
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          Each section is sized on its own — set the front and
                          back row of the middle block independently.
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        How far the horseshoe opens out from front row to back.
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {blocks.map((block, i) => (
                      <div
                        key={i}
                        className="grid gap-1.5 rounded-lg border bg-muted/20 p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            {blocks.length === 1 ? "All seats" : `Section ${i + 1}`}
                          </span>
                          {blocks.length > 1 && params.type !== "horseshoe" && (
                            <button
                              type="button"
                              onClick={() => removeBlock(i)}
                              aria-label={`Remove section ${i + 1}`}
                              className="text-xs text-muted-foreground hover:text-destructive"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <label className="grid gap-1 text-xs text-muted-foreground">
                            {tiered ? "Front row" : "Seats"}
                            <Input
                              type="number"
                              min={0}
                              max={40}
                              value={block.front}
                              onChange={(e) =>
                                editBlock(i, {
                                  front: clampInt(Number(e.target.value), 0, 40),
                                })
                              }
                              className="w-20"
                            />
                          </label>
                          {tiered && (
                            <label className="grid gap-1 text-xs text-muted-foreground">
                              Back row
                              <Input
                                type="number"
                                min={0}
                                max={40}
                                value={block.back}
                                onChange={(e) =>
                                  editBlock(i, {
                                    back: clampInt(Number(e.target.value), 0, 40),
                                  })
                                }
                                className="w-20"
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => doSave(false)} disabled={saving || previewSeats.length === 0}>
                  {saving ? "Saving…" : hasExistingRoom ? "Rebuild room" : "Save room"}
                </Button>
                <Button
                  type="button"
                  variant={editSeats ? "secondary" : "outline"}
                  onClick={() => setEditSeats((v) => !v)}
                >
                  {editSeats ? "Done removing seats" : "Remove individual seats"}
                </Button>
                <span className="text-sm text-muted-foreground">{activeSeatCount} seats</span>
              </div>
              {editSeats && (
                <p className="text-sm text-muted-foreground">
                  Tap a seat to mark it out of use — broken chairs, equipment
                  spots, gaps. Tap again to restore it.
                </p>
              )}
            </>
          )}

          {selectedHit && (
            <div className="flex items-center gap-3">
              <Button onClick={() => doAdopt(selectedHit.roomId, false)} disabled={saving}>
                {saving ? "Adopting…" : "Use this room"}
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectedHit.capacity} seats
              </span>
            </div>
          )}

          {previewSeats.length > 0 && (
            <div className="overflow-x-auto rounded-lg border bg-muted/20 p-4">
              <RoomMap
                seats={previewSeats}
                ariaLabel="Room designer preview"
                onTableMove={
                  params.type === "pods" && !selectedHit && !editSeats
                    ? moveTable
                    : undefined
                }
                onTableRemove={
                  params.type === "pods" && !selectedHit && !editSeats && params.tables > 1
                    ? removeTable
                    : undefined
                }
                onSeatTap={(seat) => {
                  if (!editSeats || selectedHit) return;
                  setRemovedSeats((prev) => {
                    const next = new Set(prev);
                    if (next.has(seat.label)) next.delete(seat.label);
                    else next.add(seat.label);
                    return next;
                  });
                }}
                stateFor={(seat) => ({
                  kind: removedSeats.has(seat.label) ? "off" : "empty",
                  tappable: editSeats && !selectedHit,
                })}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild the room?</DialogTitle>
            <DialogDescription>
              This room already has recorded check-ins. Rebuilding the map
              erases them. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Keep the current room
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() =>
                confirm?.kind === "adopt" ? doAdopt(confirm.roomId, true) : doSave(true)
              }
            >
              Rebuild and erase check-ins
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Knob({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clampInt(Number(e.target.value), min, max))}
        className="w-24"
      />
    </div>
  );
}
