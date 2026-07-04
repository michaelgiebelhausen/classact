import Papa from "papaparse";
import { rosterRowSchema } from "@/lib/validators";

export interface RosterRow {
  name: string;
  email: string;
}

export interface RowError {
  line: number;
  reason: string;
}

export interface ParsedRoster {
  rows: RosterRow[];
  errors: RowError[];
}

export const ROSTER_MAX_BYTES = 2 * 1024 * 1024; // 2MB
export const ROSTER_MAX_ROWS = 1000;

/**
 * Parse a roster CSV. Accepts headers like name,email (case-insensitive,
 * extra columns ignored) or headerless two-column files. Bad rows are
 * reported with line numbers; good rows still import.
 */
export function parseRosterCsv(csv: string): ParsedRoster {
  if (new Blob([csv]).size > ROSTER_MAX_BYTES) {
    return { rows: [], errors: [{ line: 0, reason: "File is larger than 2MB." }] };
  }

  const result = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: true });
  const data = result.data as string[][];
  if (data.length === 0) {
    return { rows: [], errors: [{ line: 0, reason: "The file is empty." }] };
  }
  if (data.length > ROSTER_MAX_ROWS + 1) {
    return {
      rows: [],
      errors: [{ line: 0, reason: `Rosters are limited to ${ROSTER_MAX_ROWS} rows.` }],
    };
  }

  // Detect a header row and column positions.
  const first = data[0].map((c) => c.trim().toLowerCase());
  let nameIdx = first.indexOf("name");
  let emailIdx = first.indexOf("email");
  let startLine = 0;
  if (nameIdx !== -1 && emailIdx !== -1) {
    startLine = 1;
  } else {
    nameIdx = 0;
    emailIdx = 1;
  }

  const rows: RosterRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();

  for (let i = startLine; i < data.length; i++) {
    const line = i + 1;
    const raw = data[i];
    const candidate = {
      name: (raw[nameIdx] ?? "").trim(),
      email: (raw[emailIdx] ?? "").trim().toLowerCase(),
    };
    const parsed = rosterRowSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({ line, reason: parsed.error.issues[0].message });
      continue;
    }
    if (seen.has(parsed.data.email)) {
      errors.push({ line, reason: `Duplicate email in file: ${parsed.data.email}` });
      continue;
    }
    seen.add(parsed.data.email);
    rows.push(parsed.data);
  }

  return { rows, errors };
}
