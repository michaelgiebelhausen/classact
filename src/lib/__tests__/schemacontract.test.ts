import { describe, expect, it } from "vitest";

import {
  SCHEMA_CONTRACT,
  describeSchemaGap,
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
