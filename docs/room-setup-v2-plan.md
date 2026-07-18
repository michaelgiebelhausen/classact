# Room Setup v2 — Plan

**Status:** Phases 1–3 built (geometry, presets/designer, room database) —
migration `0011_rooms.sql` pending in Supabase. Phase 4 (AI photo import) and
Phase 5 (moderation/dedup) not started. Visual test bench at `/dev/roommap`.
**Date:** 2026-07-18

## Why

Today's room setup is two number fields — rows × seats per row — producing a filled
rectangular grid. Real classrooms aren't rectangles: seminar tables, tiered auditoriums
with short front rows, aisles cutting through seat blocks, pods of tables. And every
professor rebuilds their room from scratch, even when three colleagues teach in the same
hall. This plan upgrades room setup to (1) a shared, growing **room database** keyed by
university/building/room, (2) a **layout designer** that handles real room shapes, and
(3) an **AI importer** that drafts a layout from a photo or registrar seating chart.

## Research: what real rooms look like

University learning-space typologies (Iowa, Dartmouth, ASU, NIU) converge on a small set
of shapes:

| Type | Shape traits | Typical capacity |
|---|---|---|
| **Classroom** (discussion/lecture) | Flat floor, straight rows, 1–2 aisles | 24–60 |
| **Seminar** | One common table (rect/oval/U), students face each other, instructor at the table | ≤ 24 |
| **Case study / horseshoe** | Curved tiered rows wrapping the front | 40–90 |
| **Auditorium / lecture hall** | Tiered rows, often curved/fan-shaped; **front rows shorter than back**; aisles every 14–16 seats (max ~22 with aisles both ends); occasional **balcony** | 85+ |
| **Active learning / pods** | 5–7 seats per movable table, tables scattered around the room, often no "front" | 30–100 |

Key facts that shape the design:

- Aisles are structural, not decorative: seating codes cap continuous seats at ~11 (one
  aisle) to ~22 (aisles both ends), so any large room *will* have aisles through seat blocks.
- Auditorium rows are frequently curved (fan layout) and row lengths vary front-to-back.
- Balconies exist but are an edge case (very large halls) — model as a second "level," don't
  build UI around them early.
- **Registrars already publish this data.** Purdue posts a seating-chart PDF for every large
  classroom (exact seats, rows, aisles); Iowa, UIC, Columbia, IU Southeast, UC Davis run
  classroom databases with photos, capacity, and layout info. This is (a) proof the
  "select your room" model matches how faculty already think, and (b) ready-made source
  material for AI import to seed our database campus-by-campus.

Sources: [Iowa classroom types](https://classrooms.uiowa.edu/classroom-scheduling/types-university-classrooms),
[Dartmouth classroom configurations](https://sites.dartmouth.edu/learning-spaces/resources/classroom-configurations/),
[Purdue seating charts](https://www.purdue.edu/registrar/faculty/scheduling/seating_charts.html),
[UIC classrooms database](https://learning.uic.edu/resources/learning-spaces/classrooms-database/),
[Columbia classrooms](https://registrar.columbia.edu/content/classrooms),
[auditorium layout guide](https://seatup.com/blog/auditorium-seating-layout-guide/),
[Irwin seating configurations](https://www.irwinseating.com/blog/things-to-know-about-seating-configurations-in-an-auditorium).

## Where the current code fights us

(From codebase audit, 2026-07-18.)

- `seats` table is pure grid: `row_index`, `col_index`, `unique(course_id, row_index, col_index)`
  (`supabase/migrations/0001_init.sql:24-33`). No x/y, no tables, no tiers.
- Adjacency is **math, not data**: `neighborCoords()` in `src/lib/seatlabels.ts:39-46`
  (row±1/col±1) feeds the check-in neighbor prompts (`CheckInLive.tsx:245-261`), server-side
  verification (`src/server/actions/checkin.ts:221-232`), and the DB enum
  `front|back|left|right`. Meaningless at a round table or across an aisle.
- Grouping uses Manhattan distance on row/col: `proximityScore` in `src/lib/participate.ts:23-32`
  (think-pair-share pairing, one-minute-paper groups).
- Both renderers (`CheckInLive.tsx:288-345`, setup preview in `CourseSetupTabs.tsx:161-180`)
  paint a dense CSS grid of `rows × cols` cells.
- **No institution model at all**: `profiles` has no university; `courses` has no room. Every
  course owns a throwaway seat grid.
- `generateSeatMap` (`src/server/actions/seatmap.ts`) is delete-all-and-rebuild from
  `{rows, cols}`.

The core shift: **from implicit grid coordinates to explicit geometry (x/y + zones/tables)
with adjacency derived from geometry, and the room promoted to a first-class reusable
entity.**

## Design

### 1. Data model

New tables (new migration, e.g. `0011_rooms.sql`):

```
universities: id, name, domain (e.g. "purdue.edu"), created_at
buildings:    id, university_id, name, code           -- "Armstrong Hall" / "ARMS"
rooms:        id, building_id, room_number, name,
              layout jsonb, layout_version int,
              capacity int (derived), layout_type text,
              source text ('professor' | 'ai_import' | 'seed'),
              created_by uuid, verified bool default false
```

Profile/course changes:

```
profiles: + university_id (nullable)   -- auto-matched from email domain, editable
courses:  + room_id (nullable)         -- the room this class meets in
seats:    + x float, + y float,        -- normalized room coordinates (0..1)
          + section text,              -- 'main' | 'balcony' | 'tableN' | tier label
          + table_id text (nullable),
          row_index/col_index become nullable "logical" coords (kept where meaningful)
```

`seats` stays per-course (check-ins, verifications, and RLS all key off it — don't disturb
that). A course's seats are **instantiated from** `rooms.layout` when the professor picks a
room; the room is the reusable template, the seats are the course's working copy.

**Layout JSON** — one schema covers every preset:

```jsonc
{
  "version": 1,
  "type": "auditorium",            // classroom | seminar | horseshoe | auditorium | pods | custom
  "sections": [
    {
      "id": "main", "kind": "rows", "level": 1,
      "tiered": true, "curve": 0.35,          // 0 = straight, 1 = semicircle
      "rows": [
        { "label": "A", "seats": 8 },          // front row, fewer seats
        { "label": "B", "seats": 10 },
        { "label": "C", "seats": 12 }
      ],
      "aisles": [ { "afterSeat": 6 } ]         // vertical aisles through the block
    },
    { "id": "balcony", "kind": "rows", "level": 2, "rows": [ ... ] },
    { "id": "t1", "kind": "table", "shape": "oval", "seats": 8, "cx": 0.3, "cy": 0.6 }
  ],
  "front": "top"                    // where the lectern/screen is
}
```

A pure function `layoutToSeats(layout) → SeatSpec[]` (with `SeatSpec` gaining `x`, `y`,
`section`, `tableId`) computes every seat's position — curved rows via arc interpolation,
tables via points around the shape perimeter. Deterministic and unit-testable, same
philosophy as `buildSeatGrid`/`assignGroups` today.

### 2. Adjacency & grouping from geometry

Replace grid arithmetic with geometry-derived neighbors:

- `computeNeighbors(seats)`: for each seat, the k nearest seats within a distance threshold,
  **never across an aisle gap or section boundary**; same-table seats are all mutual
  neighbors. Returns an adjacency list.
- Check-in verification: "confirm the classmates next to you" generalizes from
  `front/back/left/right` to "these ≤4 adjacent people." DB `relation` column loosens to a
  free-form slot label (migration alters the check constraint); server validates against the
  computed adjacency list instead of `neighborCoords`.
- `proximityScore` switches to Euclidean distance on x/y with a same-table bonus;
  `assignPairs`/`assignGroups` keep their algorithms, just a new distance function and
  seat shape (`{x, y, tableId}` instead of `{row, col}`).

### 3. Rendering

One shared `RoomMap` component (SVG, seats positioned by x/y) replaces both CSS-grid
renderers. Props: seats + per-seat state (empty/occupied/mine/verified) + onSeatTap.
Tiers render as subtle depth bands, tables as shapes under their seats, balcony as a
separated band with a divider. Works unchanged for the professor preview, the student
check-in map, and (later) the professor's live view — same visual language as today, just
positioned instead of grid-flowed.

### 4. Room setup flow (professor)

**Step 1 — "Where do you teach?"**
University auto-suggested from the professor's email domain (`@purdue.edu` → Purdue),
editable. Then building + room number with typeahead against the rooms DB.
- **Room exists** → preview its map, capacity, layout type → "Use this room" (one click, done).
- **Room doesn't exist** → continue to Step 2; on save, the layout is contributed back to
  the shared DB (marked `source: 'professor'`, `verified: false`) so the *next* professor in
  that room gets the one-click path. The database builds itself.

**Step 2 — Layout designer**
Preset picker (visual thumbnails): Classroom · Seminar table · Horseshoe · Auditorium ·
Pods. Each preset exposes only its relevant knobs:
- *Classroom*: rows, seats/row, aisle positions
- *Seminar*: table shape (rect/oval/U), seat count
- *Horseshoe*: rows, curve, seats per row
- *Auditorium*: rows with per-row seat counts (quick fill: "front 8 → back 16, linear"),
  curve, aisles, tiered toggle, "+ balcony" (edge case, tucked behind an expander)
- *Pods*: number of tables, seats per table, drag tables to position

Live `RoomMap` preview updates as knobs change; a fine-tune mode allows tap-to-remove /
tap-to-add individual seats (stored as layout `overrides`). Custom = any preset + overrides.

**Step 3 — AI import (the "really cool" one)**
"Or upload a photo of your room." Professor uploads a phone photo, a registrar seating-chart
PDF/screenshot, or a room-database photo. A server action sends it to Claude vision with the
layout JSON schema as the output contract → returns a draft layout → opens **in the designer**
for review and touch-up before saving. AI drafts, professor confirms — mistakes cost one
minute of dragging, not a broken check-in.

The same pipeline, pointed at registrar seating-chart PDFs (e.g. Purdue publishes one per
large hall), lets us pre-seed entire campuses (`source: 'seed'`) before any professor signs up.

### 5. What doesn't change

Check-in claim logic (keyed on `seat_id`), the realtime channel, verified-flip trigger,
photo directory, sessions, all Participate algorithms above the distance function, RLS
structure. The blast radius is deliberately: schema + geometry lib + two renderers + one
form.

## Phasing

**Phase 1 — Geometry foundation** *(enables everything, zero visible change)*
Migration (x/y/section/table_id on seats; relax grid constraint), `layoutToSeats` +
`computeNeighbors` in `src/lib/roomlayout.ts` with a full test suite, `RoomMap` SVG
component, swap both renderers, generalize verification + `proximityScore`.
Rect-grid layouts reproduce today's behavior exactly (x=col, y=row); existing courses
backfill trivially.

**Phase 2 — Presets & designer**
Layout JSON schema finalized, preset picker + knob forms + live preview + seat overrides,
`saveRoomLayout` server action replaces `generateSeatMap`'s `{rows, cols}` payload.

**Phase 3 — Room database**
`universities`/`buildings`/`rooms` tables + RLS (rooms readable by all authenticated users
at that university, writable by creator), email-domain auto-match, building/room typeahead,
"use this room" path, contribute-on-create.

**Phase 4 — AI import**
Photo/PDF upload → Claude vision → draft layout → designer review. Optional: seeding
script for registrar seating-chart PDFs.

**Phase 5 — Edge cases (as demanded)**
Balcony/multi-level polish, free-form custom editor, room verification/moderation for the
shared DB, duplicate-room merging.

## Open questions

1. **Cross-university privacy**: rooms are shared within a university — is a global public
   room DB okay long-term, or scope reads to same-domain users? (Plan assumes same-university
   visibility.)
2. **Room edits after adoption**: if professor B edits a shared room professor A is using,
   A's seats shouldn't move mid-semester → courses snapshot the layout at adoption
   (`layout_version` pin), room edits create new versions. Plan assumes snapshot semantics.
3. **Email domains**: professors on `gmail.com` (like dev/test accounts) get no auto-match —
   university becomes a searchable/creatable field, seeded with a starter list.
