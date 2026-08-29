import { describe, expect, it } from "vitest";

import { healthReport } from "@/lib/healthreport";
import type { SchemaGap } from "@/lib/schemacontract";

const gap = (over: Partial<SchemaGap> = {}): SchemaGap => ({
  table: "lecture_note_entries",
  migration: "0038_note_entries.sql",
  detail: "Could not find the table 'public.lecture_note_entries'",
  ...over,
});

describe("healthReport", () => {
  it("is ok and 200 when the database has everything this build reads", () => {
    const r = healthReport({ healthy: true, gaps: [], skipped: false });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.schema.status).toBe("ok");
  });

  // The whole point of the change. On 2026-08-28 this endpoint answered
  // {"ok":true} for hours while the notes feature ran against a database
  // that had never seen 0038.
  it("stops saying ok while the database is behind", () => {
    const r = healthReport({ healthy: false, gaps: [gap()], skipped: false });
    expect(r.body.ok).toBe(false);
    expect(r.body.schema.status).toBe("behind");
  });

  // A monitor that only reads the status code has to see this too, or the
  // endpoint is still lying to everything that isn't parsing JSON.
  it("answers 503 so a monitor that reads only the code still learns", () => {
    const r = healthReport({ healthy: false, gaps: [gap()], skipped: false });
    expect(r.status).toBe(503);
  });

  it("names the migrations to run, de-duplicated, so the fix needs no lookup", () => {
    const r = healthReport({
      healthy: false,
      skipped: false,
      gaps: [
        gap({ table: "rankings", migration: "0037_speed_grader.sql" }),
        gap({ table: "taste_files", migration: "0037_speed_grader.sql" }),
        gap(),
      ],
    });
    expect(r.body.schema.migrations).toEqual([
      "0037_speed_grader.sql",
      "0038_note_entries.sql",
    ]);
    expect(r.body.schema.gaps).toHaveLength(3);
    expect(r.body.schema.gaps?.[0]).toMatchObject({ table: "rankings" });
  });

  // A developer with no service role key configured has not got a broken
  // deployment — they have an unaskable question. Reporting that as a
  // failure would train everyone to ignore a red health check.
  it("reports an unchecked schema as unknown, not as a failure", () => {
    const r = healthReport({ healthy: true, gaps: [], skipped: true });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.schema.status).toBe("unknown");
  });

  // Callers should be able to trust `ok` alone. If a healthy answer ever
  // carried gaps, something upstream is confused and the safe reading of a
  // contradiction is "not healthy".
  it("treats a contradictory probe as behind rather than believing healthy", () => {
    const r = healthReport({ healthy: true, gaps: [gap()], skipped: false });
    expect(r.body.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  it("omits gap fields entirely when there is nothing wrong", () => {
    const r = healthReport({ healthy: true, gaps: [], skipped: false });
    expect(r.body.schema.gaps).toBeUndefined();
    expect(r.body.schema.migrations).toBeUndefined();
  });
});
