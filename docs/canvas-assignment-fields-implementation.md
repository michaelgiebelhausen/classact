# Assignment fields (0033) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a ClassAct assignment student-facing instructions text and a
point value, and store the Canvas identity a future gradebook CSV export
will need.

**Architecture:** Four new columns on `public.assignments`, one on
`public.enrollments`. Validation lives in a pure module (`src/lib/`) so it
is unit-testable without a database, matching `seatmove.ts` and
`rosterstage.ts`. Server actions call the validator; the UI adds two inputs
to the existing create and edit forms. The Canvas roster sync starts keeping
the Canvas user id it already fetches and currently discards.

**Tech Stack:** Next.js (App Router, server actions), Supabase/Postgres,
TypeScript, vitest, shadcn/ui + Tailwind.

**Spec:** `docs/canvas-assignment-fields-plan.md`

---

## Naming hazards — read before starting

Two collisions in this area. Both are easy to trip over and hard to spot in
review.

1. **`instructions` vs `settings.gradingInstructions`.** The new
   `assignments.instructions` column is the **student-facing brief** — what
   the assignment asks for. `settings.gradingInstructions` already exists
   and is the professor's **private AI grading criteria** for `ai_only`
   assignments. Similar name, opposite audience. Never conflate them, and
   never render `gradingInstructions` to a student.
2. **`published_at`.** In ClassAct this means *grades released to students*.
   In Canvas, `published` means *students can see the assignment exists*.
   Do not add any Canvas publish state under a name resembling this one.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/0033_assignment_fields.sql` (create) | The five columns |
| `src/lib/assignmentfields.ts` (create) | Pure validation/normalisation of instructions + points |
| `src/lib/__tests__/assignmentfields.test.ts` (create) | Unit tests for the above |
| `src/types/db.ts` (modify) | `AssignmentRow`, `EnrollmentRow` |
| `src/server/actions/assignments.ts` (modify) | `createAssignment`, `updateAssignment` |
| `src/server/actions/canvas.ts` (modify) | Keep `canvas_user_id` during roster sync |
| `src/components/features/assignments/AssignmentCreate.tsx` (modify) | Two new inputs |
| `src/components/features/assignments/AssignmentEdit.tsx` (modify) | Two new inputs |
| `HANDOFF.md` (modify) | Deployment note — the migration must run first |

---

### Task 1: Migration and types

No tests: this is schema plus type declarations, both verified by `npm run
typecheck` and by the migration running cleanly.

**Files:**
- Create: `supabase/migrations/0033_assignment_fields.sql`
- Modify: `src/types/db.ts:219-231` (`AssignmentRow`), `src/types/db.ts:369-393` (`EnrollmentRow`)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0033_assignment_fields.sql`:

```sql
-- 0033: what an assignment says, what it's worth, and who it is in Canvas.
--
-- Until now the only way a professor could state the brief was uploading a
-- PDF, so writing two sentences meant opening a word processor first;
-- `instructions` removes that. `points` is a plain value the assignment
-- carries — it deliberately does NOT feed cut points, letters, or ranking
-- (that's the speed-grader work), it just stops an assignment from being
-- worth nothing at all.
--
-- The three canvas_* columns are identity for a future gradebook CSV
-- export. Grades reach Canvas as a CSV the professor uploads by hand, not
-- as an API write, so nothing here implies a token. See
-- docs/canvas-assignment-fields-plan.md.

alter table public.assignments
  -- Student-facing brief. NOT settings.gradingInstructions, which is the
  -- professor's private AI grading criteria for ai_only assignments.
  add column if not exists instructions text not null default '',
  -- Nullable on purpose, against the house not-null-default habit: null is
  -- "no point value set", which is a different fact from "worth zero".
  -- numeric, not int — real gradebooks carry 3.50 and 4.25.
  add column if not exists points numeric,
  -- The Canvas column this assignment maps to. Retained in a CSV header as
  -- "Title (2338931)" so Canvas updates in place instead of creating a
  -- duplicate column.
  add column if not exists canvas_assignment_id text,
  -- When we last GENERATED a CSV. Never proof Canvas received it — the
  -- professor uploads by hand and we get no confirmation.
  add column if not exists canvas_exported_at timestamptz;

alter table public.enrollments
  -- The Canvas user id: the "ID" column of a gradebook CSV, and how Canvas
  -- matches a row to a student. Email is fine for importing a roster and
  -- wrong for writing grades back.
  add column if not exists canvas_user_id text;
```

No RLS changes: the existing `assignments_select` / `assignments_write`
policies from 0013 are table-scoped and already cover new columns.

- [ ] **Step 2: Add the assignment columns to the row type**

In `src/types/db.ts`, replace the `AssignmentRow` type:

```ts
export type AssignmentRow = {
  id: string
  course_id: string
  title: string
  storage_path: string | null
  /** 0033 — the student-facing brief, plain text. Distinct from
   *  settings.gradingInstructions, which is the professor's private AI
   *  grading criteria and must never be shown to a student. */
  instructions: string
  /** 0033 — what the assignment is worth. Null = no value set, which is
   *  not the same fact as zero. Feeds nothing yet. */
  points: number | null
  /** 0033 — the Canvas gradebook column this maps to, retained in a CSV
   *  header so a re-export updates rather than duplicates. */
  canvas_assignment_id: string | null
  /** 0033 — when we last generated a Canvas CSV. Not proof Canvas got it:
   *  the professor uploads by hand and never reports back. */
  canvas_exported_at: string | null
  deadline: string
  peer_close_at: string
  settings: Record<string, unknown>
  state: AssignmentState
  analysis: Record<string, unknown>
  published_at: string | null
  created_at: string
}
```

- [ ] **Step 3: Add the enrollment column to the row type**

In `src/types/db.ts`, inside `EnrollmentRow`, add immediately after the
`canvas_seen_at` field:

```ts
  /** 0033 — the Canvas user id, which a gradebook CSV uses as its "ID"
   *  column to match a row to a student. Populated by the roster sync;
   *  null for anyone Canvas never listed. */
  canvas_user_id: string | null
```

- [ ] **Step 4: Verify types compile**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 5: Add the deployment note**

In `HANDOFF.md`, add a new section immediately above the existing
`## A student's school email vs their login (0032)` heading:

```markdown
## Assignment instructions, points, and Canvas identity (0033)

**Run `supabase/migrations/0033_assignment_fields.sql` BEFORE deploying** —
the assignment queries select `instructions` and `points`, and the Canvas
roster sync writes `enrollments.canvas_user_id`. Without the columns the
assignment pages and the sync both fail.

`instructions` is the student-facing brief and is additive: `storage_path`
(the brief PDF) still works exactly as before, and an assignment may have
either, both, or neither.

`points` is nullable on purpose. Null means "no point value set", which is
a different fact from zero. Nothing reads it yet — it does not affect cut
points, letters, or ranking.

`canvas_assignment_id`, `canvas_exported_at` and `canvas_user_id` are
identity for a future Canvas gradebook CSV export and are unused today.
Only `canvas_user_id` gets populated (by the roster sync, for free). See
`docs/canvas-assignment-fields-plan.md`.
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0033_assignment_fields.sql src/types/db.ts HANDOFF.md
git commit -m "An assignment can say what it asks for and what it's worth"
```

---

### Task 2: The validation module (TDD)

**Files:**
- Create: `src/lib/assignmentfields.ts`
- Test: `src/lib/__tests__/assignmentfields.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/assignmentfields.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { normalizeInstructions, normalizePoints } from "@/lib/assignmentfields";

describe("normalizeInstructions", () => {
  test("trims surrounding whitespace", () => {
    expect(normalizeInstructions("  write a brief  ")).toEqual({
      ok: true,
      value: "write a brief",
    });
  });

  test("treats empty input as empty, not an error", () => {
    expect(normalizeInstructions("   ")).toEqual({ ok: true, value: "" });
  });

  test("accepts exactly the maximum length", () => {
    const verdict = normalizeInstructions("x".repeat(5000));

    expect(verdict.ok).toBe(true);
  });

  test("refuses one character over the maximum", () => {
    const verdict = normalizeInstructions("x".repeat(5001));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("instructions_too_long");
  });

  test("measures length after trimming, not before", () => {
    const verdict = normalizeInstructions(`   ${"x".repeat(5000)}   `);

    expect(verdict.ok).toBe(true);
  });
});

describe("normalizePoints", () => {
  test("an empty string means no value set, not zero", () => {
    expect(normalizePoints("")).toEqual({ ok: true, value: null });
  });

  test("whitespace also means no value set", () => {
    expect(normalizePoints("   ")).toEqual({ ok: true, value: null });
  });

  test("null and undefined mean no value set", () => {
    expect(normalizePoints(null)).toEqual({ ok: true, value: null });
    expect(normalizePoints(undefined)).toEqual({ ok: true, value: null });
  });

  test("accepts a whole number", () => {
    expect(normalizePoints("10")).toEqual({ ok: true, value: 10 });
  });

  test("accepts a fractional number — real gradebooks carry 4.25", () => {
    expect(normalizePoints("4.25")).toEqual({ ok: true, value: 4.25 });
  });

  test("accepts a number, not just a string", () => {
    expect(normalizePoints(3.5)).toEqual({ ok: true, value: 3.5 });
  });

  test("accepts zero as a real value, distinct from unset", () => {
    expect(normalizePoints("0")).toEqual({ ok: true, value: 0 });
  });

  test("normalises negative zero to zero", () => {
    const verdict = normalizePoints("-0");

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(Object.is(verdict.value, -0)).toBe(false);
    expect(verdict.value).toBe(0);
  });

  test("refuses text", () => {
    const verdict = normalizePoints("ten");

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("points_not_a_number");
  });

  test("refuses infinity", () => {
    const verdict = normalizePoints("Infinity");

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("points_not_a_number");
  });

  test("refuses a negative value", () => {
    const verdict = normalizePoints("-5");

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("points_negative");
  });

  test("refusals carry a message the professor can act on", () => {
    const verdict = normalizePoints("-5");

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.message.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/lib/__tests__/assignmentfields.test.ts`
Expected: FAIL — cannot resolve `@/lib/assignmentfields`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/assignmentfields.ts`:

```ts
/**
 * The two fields an assignment gained in 0033, validated away from the
 * database so the rules can be tested directly.
 *
 * Both refuse rather than coerce. A professor who types "ten" into points
 * has made a mistake worth telling them about; silently storing null (or
 * zero) would hide it until a grade came out wrong.
 *
 * The empty-means-null rule on points is the load-bearing one. Null is "no
 * point value set" and zero is "worth zero points" — different facts, and
 * collapsing them would make every untouched assignment look deliberately
 * worthless.
 */

export const MAX_INSTRUCTIONS = 5000;

export type AssignmentFieldError =
  | "instructions_too_long"
  | "points_not_a_number"
  | "points_negative";

export type FieldVerdict<T> =
  | { ok: true; value: T }
  | { ok: false; code: AssignmentFieldError; message: string };

/** The student-facing brief. Empty is legitimate — an assignment can carry
 *  a PDF instead, or nothing at all. */
export function normalizeInstructions(raw: string): FieldVerdict<string> {
  const value = raw.trim();
  if (value.length > MAX_INSTRUCTIONS) {
    return {
      ok: false,
      code: "instructions_too_long",
      message: `Instructions can be up to ${MAX_INSTRUCTIONS.toLocaleString()} characters — that's ${value.length.toLocaleString()}.`,
    };
  }
  return { ok: true, value };
}

/** What the assignment is worth. Null = not set; zero = worth zero. */
export function normalizePoints(
  raw: string | number | null | undefined
): FieldVerdict<number | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") {
    return { ok: true, value: null };
  }

  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      code: "points_not_a_number",
      message: "Points has to be a number — leave it blank if the assignment isn't worth points.",
    };
  }
  if (parsed < 0) {
    return {
      ok: false,
      code: "points_negative",
      message: "Points can't be negative.",
    };
  }

  // -0 survives both checks above and is a nuisance downstream.
  return { ok: true, value: parsed === 0 ? 0 : parsed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/__tests__/assignmentfields.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assignmentfields.ts src/lib/__tests__/assignmentfields.test.ts
git commit -m "Points refuses nonsense instead of quietly storing zero"
```

---

### Task 3: Accept both fields in the server actions

**Files:**
- Modify: `src/server/actions/assignments.ts:56-73` (`createAssignment` signature), `:150-165` (insert payload), `:331-338` (`updateAssignment` signature), `:357-380` (patch)

- [ ] **Step 1: Import the validators**

At the top of `src/server/actions/assignments.ts`, alongside the existing
imports, add:

```ts
import { normalizeInstructions, normalizePoints } from "@/lib/assignmentfields";
```

- [ ] **Step 2: Extend the `createAssignment` signature**

In the `createAssignment` input type, add these two members after
`storagePath`:

```ts
  /** Student-facing brief. NOT gradingInstructions, which is the
   *  professor's private AI criteria for ai_only assignments. */
  instructions?: string;
  /** What the assignment is worth. Blank/absent = no value set. */
  points?: string | number | null;
```

- [ ] **Step 3: Validate before the insert**

In `createAssignment`, immediately after the existing `title` check
(`if (!title) return { ok: false, error: "Give the assignment a title." };`),
add:

```ts
  const instructions = normalizeInstructions(input.instructions ?? "");
  if (!instructions.ok) return { ok: false, error: instructions.message };
  const points = normalizePoints(input.points);
  if (!points.ok) return { ok: false, error: points.message };
```

- [ ] **Step 4: Write both to the insert payload**

In the same function, in the object passed to `.insert({...})`, add these
two entries directly after `storage_path: input.storagePath,`:

```ts
      instructions: instructions.value,
      points: points.value,
```

- [ ] **Step 5: Extend the `updateAssignment` signature**

In the `updateAssignment` input type, add after `assignmentId`:

```ts
  instructions?: string;
  points?: string | number | null;
```

- [ ] **Step 6: Widen the patch type**

In `updateAssignment`, replace the `patch` declaration:

```ts
  const patch: Partial<
    Pick<
      AssignmentRow,
      "title" | "deadline" | "peer_close_at" | "instructions" | "points"
    >
  > = {};
```

- [ ] **Step 7: Add both to the patch**

In `updateAssignment`, immediately after the existing `if (input.title !==
undefined) { ... }` block, add:

```ts
  // Neither field is state-gated. Unlike the deadline — which is baked into
  // the analysis once grading starts — a typo in the brief or the point
  // value is worth fixing at any point in the assignment's life.
  if (input.instructions !== undefined) {
    const verdict = normalizeInstructions(input.instructions);
    if (!verdict.ok) return { ok: false, error: verdict.message };
    patch.instructions = verdict.value;
  }

  if (input.points !== undefined) {
    const verdict = normalizePoints(input.points);
    if (!verdict.ok) return { ok: false, error: verdict.message };
    patch.points = verdict.value;
  }
```

- [ ] **Step 8: Feed instructions to the taste-file draft**

Still in `createAssignment`: the AI drafts the default taste file from the
brief PDF only, so a professor who types instructions instead of uploading a
PDF silently gets a blank taste file. Find the `if (gradingMode === "tasty")`
block that calls `resolveCourseAi(input.courseId, "taste")`, and ensure the
drafting call receives `instructions.value` in addition to `briefBase64`.
Pass it as the brief text wherever the draft helper accepts prose; if the
helper takes only a PDF, add an optional second parameter for the text and
have the helper prefer the PDF when both are present.

Do not skip this step: a text-only assignment producing a blank taste file
is a silent degradation, and text-only is about to become the common case.

- [ ] **Step 9: Verify it compiles**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 10: Commit**

```bash
git add src/server/actions/assignments.ts
git commit -m "Creating an assignment can carry its brief and its worth"
```

---

### Task 4: Keep the Canvas user id the sync already fetches

**Files:**
- Modify: `src/server/actions/canvas.ts:27-31` (`CanvasStudent`), `:165-171` (the push into `students`), and the enrollment write region around `:289-405`

- [ ] **Step 1: Add the field to the student shape**

In `src/server/actions/canvas.ts`, replace the `CanvasStudent` interface:

```ts
export interface CanvasStudent {
  name: string;
  email: string;
  avatarUrl: string | null; // null when Canvas returns a generic default
  /** 0033 — Canvas's own user id. A gradebook CSV matches rows on this, so
   *  a grade export needs it; email is fine for reading a roster and wrong
   *  for writing grades back. */
  canvasUserId: string;
}
```

- [ ] **Step 2: Populate it during the roster fetch**

In the same file, in the loop that builds `students`, replace the
`students.push({...})` call:

```ts
      students.push({
        name: u.name?.trim() || email,
        email,
        avatarUrl: real ? (u.avatar_url as string) : null,
        canvasUserId: String(u.id),
      });
```

`CanvasUser.id` is already declared and already fetched — it was simply
being dropped.

- [ ] **Step 3: Stamp it onto matched enrollments**

The sync has several enrollment write paths (twin merge, twin adopt, fresh
insert, reactivate, confirm). Rather than threading the id through each,
add one idempotent pass. Place it immediately after the `confirming` loop
(the block ending `.eq("id", e.id);` before the final summary), so it runs
whichever branch created the row:

```ts
  // Canvas identity for a future gradebook CSV export. One pass over
  // everyone Canvas just listed, after every other branch has settled, so
  // it doesn't matter which one created the row. Idempotent: only writes
  // when the value is actually new, so a resync that changes nothing costs
  // nothing.
  const idByEmail = new Map(
    roster.students.map((s) => [s.email, s.canvasUserId])
  );
  const { data: forIds } = await supabase
    .from("enrollments")
    .select("id, roster_email, canvas_user_id")
    .eq("course_id", course.id);
  for (const e of forIds ?? []) {
    const canvasUserId = idByEmail.get(e.roster_email);
    if (!canvasUserId || e.canvas_user_id === canvasUserId) continue;
    await supabase
      .from("enrollments")
      .update({ canvas_user_id: canvasUserId })
      .eq("id", e.id);
  }
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/canvas.ts
git commit -m "The roster sync stops throwing away Canvas's user id"
```

---

### Task 5: The two inputs in the create form

**Files:**
- Modify: `src/components/features/assignments/AssignmentCreate.tsx`

- [ ] **Step 1: Add state for both fields**

Alongside the existing `useState` declarations in `AssignmentCreate`, add:

```tsx
  const [instructions, setInstructions] = useState("");
  const [points, setPoints] = useState("");
```

- [ ] **Step 2: Render the inputs**

Place this block directly after the title field's `<div className="grid
gap-1.5">…</div>` and before the deadline field, so the form reads
title → brief → worth → dates:

```tsx
        <div className="grid gap-1.5">
          <Label htmlFor="new-instructions">Instructions</Label>
          <textarea
            id="new-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={5}
            maxLength={5000}
            placeholder="What are they making, and what does done look like?"
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">
            Optional — a brief PDF still works, and you can use both.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="new-points">Points</Label>
          <Input
            id="new-points"
            type="number"
            min="0"
            step="any"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="max-w-[120px]"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank if this assignment isn&apos;t worth points.
          </p>
        </div>
```

`step="any"` matters: the default is `step="1"`, which makes a browser
reject 4.25 — a value real gradebooks contain.

- [ ] **Step 3: Send both to the action**

In the submit handler, add both to the `createAssignment({...})` call:

```tsx
        instructions,
        points,
```

Pass `points` as the raw string. `normalizePoints` handles the empty case,
and converting in the component would turn `""` into `0` — exactly the
unset-versus-zero collapse the field is designed to avoid.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/assignments/AssignmentCreate.tsx
git commit -m "A new assignment can be written, not just uploaded"
```

---

### Task 6: The two inputs in the edit form

**Files:**
- Modify: `src/components/features/assignments/AssignmentEdit.tsx`

- [ ] **Step 1: Accept both as props**

In the `Props` interface, add:

```tsx
  instructions: string;
  points: number | null;
```

- [ ] **Step 2: Destructure and seed state**

Change the component signature to take the new props, renaming them so the
initial values stay available for diffing (the file already uses this
`initialTitle` idiom):

```tsx
export function AssignmentEdit({
  assignmentId,
  state,
  title: initialTitle,
  instructions: initialInstructions,
  points: initialPoints,
  deadline,
  peerCloseAt,
}: Props) {
```

Then, beside the existing `useState` calls:

```tsx
  const initialPointsText = initialPoints === null ? "" : String(initialPoints);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [points, setPoints] = useState(initialPointsText);
```

- [ ] **Step 3: Include them in the diff**

In `save()`, after the existing title diff line, add:

```tsx
    if (instructions !== initialInstructions) input.instructions = instructions;
    if (points !== initialPointsText) input.points = points;
```

- [ ] **Step 4: Extend the no-op guard**

The existing early return only checks three fields, so an edit that touched
only instructions or points would silently close the form without saving.
Replace it:

```tsx
    if (Object.keys(input).length <= 1) {
      // Only assignmentId — nothing was actually changed.
      setOpen(false);
      return;
    }
```

- [ ] **Step 5: Render the inputs**

After the title field's `<div className="grid gap-1.5">…</div>` and before
the deadline field:

```tsx
        <div className="grid gap-1.5">
          <Label htmlFor="edit-instructions">Instructions</Label>
          <textarea
            id="edit-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={5}
            maxLength={5000}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit-points">Points</Label>
          <Input
            id="edit-points"
            type="number"
            min="0"
            step="any"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="max-w-[120px]"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank if this assignment isn&apos;t worth points.
          </p>
        </div>
```

Neither field is disabled by `state`: unlike the deadline, a typo in the
brief is worth fixing at any point in the assignment's life.

- [ ] **Step 6: Pass the new props from the page**

Find the `<AssignmentEdit …/>` call site:

```bash
grep -rn "AssignmentEdit" src/app
```

Add `instructions={assignment.instructions}` and
`points={assignment.points}` to it. If the page's Supabase query names its
columns explicitly rather than using `select("*")`, add `instructions` and
`points` to that list too — otherwise they arrive undefined at runtime while
typechecking cleanly.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npm test -- --run`
Expected: all three exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/components/features/assignments/AssignmentEdit.tsx src/app
git commit -m "The brief and the points can be fixed after the fact"
```

---

### Task 7: Show the instructions to students

Storing a brief nobody reads is worse than not having the field. Students
are the audience.

**Files:**
- Modify: the student-facing assignment view (find it in step 1)

- [ ] **Step 1: Find where a student sees the assignment**

```bash
grep -rn "storage_path\|brief" src/app/\(app\)/course --include=*.tsx | head
```

The student view is the page rendering `SubmissionEditor`. Identify the
component that shows the assignment title and brief-PDF link to a student.

- [ ] **Step 2: Render instructions above the submission control**

Add, above the existing brief-PDF link and below the title:

```tsx
{assignment.instructions && (
  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
    {assignment.instructions}
  </p>
)}
```

`whitespace-pre-wrap` preserves the professor's paragraph breaks. Render as
text, never `dangerouslySetInnerHTML` — the field is plain text precisely so
it can be rendered safely.

- [ ] **Step 3: Confirm the query selects it**

If that page's Supabase query lists columns explicitly, add `instructions`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app src/components
git commit -m "Students read the brief without opening a PDF"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run everything**

Run: `npm run typecheck && npm run lint && npm test -- --run && npm run build`
Expected: all four exit 0.

- [ ] **Step 2: Apply the migration by hand**

Paste `supabase/migrations/0033_assignment_fields.sql` into the Supabase SQL
editor and run it. This is the project's standing practice — migrations are
applied manually, and this one must land **before** the deploy.

- [ ] **Step 3: Smoke-test against the running app**

- [ ] Create an assignment with instructions and points; confirm both persist
      after a reload.
- [ ] Create an assignment with **no** points; confirm the field is empty on
      reload, not `0`.
- [ ] Enter `4.25` in points; confirm it saves as 4.25.
- [ ] Enter `-5`; confirm a readable refusal, not a silent save.
- [ ] Edit an existing assignment's instructions only; confirm Save persists
      it (this is what the no-op guard in Task 6 Step 4 protects).
- [ ] Open the assignment as a student; confirm the instructions render with
      paragraph breaks intact.
- [ ] Run a Canvas roster resync on a course with a connected token; confirm
      `enrollments.canvas_user_id` populates.

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "Fixes from smoke-testing assignment fields"
```

Note `git add -u` rather than `git add -A`: the FERPA ignore rule added in
`.gitignore` covers `*Grades-*.csv`, but staging only tracked files is the
safer habit while student-data exports are moving through this tree.

---

## Out of scope

The Canvas CSV export itself, and the gradebook ingest that would supply
`canvas_assignment_id`. Both are specified in
`docs/canvas-assignment-fields-plan.md`; neither is built here.
`canvas_assignment_id` and `canvas_exported_at` stay null until then.

Two questions in that spec need answering against a live Canvas course
before the export can be designed: whether Canvas tolerates blank SIS User
ID and Section columns, and whether the import drop-down can map an
unrecognised column onto an existing assignment.
