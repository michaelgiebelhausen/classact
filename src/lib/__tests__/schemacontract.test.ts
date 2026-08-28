import { describe, expect, it } from "vitest";

import {
  CHECKIN_TABLES,
  SCHEMA_CONTRACT,
  describeSchemaGap,
  gapsForTables,
  isSchemaGapCode,
  migrationsToRun,
  type SchemaGap,
} from "@/lib/schemacontract";

const gap = (over: Partial<SchemaGap> = {}): SchemaGap => ({
  table: "check_ins",
  migration: "0036_neighbor_denials.sql",
  detail: 'column check_ins.denied_count does not exist',
  ...over,
});

describe("isSchemaGapCode", () => {
  it("treats a missing column or table as a real gap", () => {
    expect(isSchemaGapCode("42703")).toBe(true); // undefined_column
    expect(isSchemaGapCode("42P01")).toBe(true); // undefined_table
  });

  // A missing table never reaches Postgres: PostgREST resolves the name
  // against its own schema cache and 404s on its own authority. Without
  // this, every table-level contract entry was undetectable.
  it("catches PostgREST's own missing-table answer", () => {
    expect(isSchemaGapCode("PGRST205")).toBe(true);
  });

  // The safety property: only Postgres saying "that doesn't exist" counts.
  // Anything else could be a blip, and blanking a working seat map mid-class
  // over a dropped connection would be worse than the bug this guards.
  it("never mistakes a transient failure for a schema gap", () => {
    for (const code of ["", undefined, "08006", "57014", "53300", "42501", "PGRST301"]) {
      expect(isSchemaGapCode(code)).toBe(false);
    }
  });
});

describe("migrationsToRun", () => {
  it("de-duplicates when several tables need the same migration", () => {
    expect(
      migrationsToRun([
        gap(),
        gap({ table: "seat_denials", detail: "relation does not exist" }),
      ])
    ).toEqual(["0036_neighbor_denials.sql"]);
  });

  it("keeps every distinct migration", () => {
    expect(
      migrationsToRun([
        gap(),
        gap({ table: "profiles", migration: "0032_school_email.sql" }),
      ])
    ).toEqual(["0036_neighbor_denials.sql", "0032_school_email.sql"]);
  });

  it("is empty when nothing is missing", () => {
    expect(migrationsToRun([])).toEqual([]);
  });
});

describe("gapsForTables", () => {
  const unrelated = gap({
    table: "assignments",
    migration: "0033_assignment_fields.sql",
    detail: "column assignments.points does not exist",
  });

  // The property that keeps this guard from being worse than the bug: a
  // migration check-in doesn't read must never take attendance offline.
  it("does not report an unrelated table's gap to the check-in page", () => {
    expect(gapsForTables([unrelated], CHECKIN_TABLES)).toEqual([]);
  });

  it("still reports check-in's own tables", () => {
    expect(gapsForTables([gap()], CHECKIN_TABLES)).toHaveLength(1);
    expect(
      gapsForTables([gap({ table: "seat_denials" })], CHECKIN_TABLES)
    ).toHaveLength(1);
  });

  it("keeps only the relevant half of a mixed result", () => {
    const kept = gapsForTables([unrelated, gap()], CHECKIN_TABLES);
    expect(kept.map((g) => g.table)).toEqual(["check_ins"]);
  });

  it("every check-in table is actually in the contract", () => {
    for (const table of CHECKIN_TABLES) {
      expect(SCHEMA_CONTRACT.some((e) => e.table === table)).toBe(true);
    }
  });
});

describe("describeSchemaGap", () => {
  it("says nothing when the schema is fine", () => {
    expect(describeSchemaGap([])).toBe("");
  });

  it("names the table, Postgres's own words, and the file to run", () => {
    const message = describeSchemaGap([gap()]);
    expect(message).toContain("check_ins");
    expect(message).toContain("column check_ins.denied_count does not exist");
    expect(message).toContain("supabase/migrations/0036_neighbor_denials.sql");
  });

  // The alert has to explain the SYMPTOM, because the symptom is what gets
  // noticed first — an empty room, not an error.
  it("warns that pages will look empty rather than broken", () => {
    const message = describeSchemaGap([gap()]);
    expect(message.toLowerCase()).toContain("empty");
  });

  it("lists each migration once even with many gaps", () => {
    const message = describeSchemaGap([
      gap(),
      gap({ table: "seat_denials", detail: "relation does not exist" }),
    ]);
    const occurrences = message.split("supabase/migrations/0036_neighbor_denials.sql").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("SCHEMA_CONTRACT", () => {
  it("names a migration file for every entry", () => {
    for (const entry of SCHEMA_CONTRACT) {
      expect(entry.table).not.toBe("");
      expect(entry.migration).toMatch(/\.sql/);
    }
  });

  it("covers the columns whose absence caused the silent empty room", () => {
    const checkIns = SCHEMA_CONTRACT.find((e) => e.table === "check_ins");
    expect(checkIns?.columns).toContain("denied_count");
    expect(checkIns?.columns).toContain("professor_confirmed_at");
  });

  it("has one entry per table, so one probe covers each", () => {
    const tables = SCHEMA_CONTRACT.map((e) => e.table);
    expect(new Set(tables).size).toBe(tables.length);
  });
});
