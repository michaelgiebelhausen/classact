/**
 * Student notes, rendered as Markdown.
 *
 * Pure and isomorphic on purpose: the browser calls this to build the file a
 * student downloads, and the server calls the same function to build the file
 * it emails. One implementation means the two can't drift into disagreeing
 * about what a student's notes look like.
 *
 * The shape is chosen for what happens *after* the export — a notes vault, an
 * agent asked to revise for an exam. Hence YAML frontmatter (every Second
 * Brain tool reads it), a heading per lecture, and a heading per slide: the
 * slide number is the one piece of structure a hand-kept notebook can't
 * record, so it should survive the trip out of the app.
 */

/** Bumped if the layout below changes in a way a downstream parser would notice. */
export const NOTES_EXPORT_VERSION = 1;

export interface ExportEntry {
  /** Slide on screen when it was typed; null for notes imported from the old freeform box. */
  page: number | null;
  content: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface ExportLecture {
  /** ISO timestamp. */
  startedAt: string;
  deckTitle: string;
  entries: ExportEntry[];
}

export interface NotesExportInput {
  courseName: string;
  /** ISO timestamp. */
  exportedAt: string;
  /** IANA zone, so timestamps read as the times the student experienced. */
  timeZone?: string;
  lectures: ExportLecture[];
}

const UNSTAMPED_HEADING = "General notes";

/**
 * Intl puts a narrow no-break space before AM/PM in newer ICU versions. It is
 * invisible in a browser and a mystery in a text editor, so it goes.
 */
function normalizeSpaces(text: string): string {
  return text.replace(/[  ]/g, " ");
}

/** A zone we can't format in isn't worth throwing an export away over. */
function safeZone(timeZone?: string): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return "UTC";
  }
}

function formatDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Undated";
  return normalizeSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date)
  );
}

function formatTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return normalizeSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date)
  );
}

/** YAML double-quoted scalar: backslashes first, then the quotes. */
function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * One entry as a list item. Continuation lines are indented two spaces so a
 * multi-paragraph thought stays inside its bullet instead of escaping the list
 * and losing its timestamp.
 */
function renderEntry(entry: ExportEntry, timeZone: string): string {
  const time = formatTime(entry.createdAt, timeZone);
  const [first = "", ...rest] = entry.content.trim().split("\n");
  const head = time ? `- ${time} — ${first}` : `- ${first}`;
  // A blank line stays blank: two spaces of nothing is trailing whitespace.
  const tail = rest.map((line) => (line.trim() === "" ? "" : `  ${line}`));
  return [head, ...tail].join("\n");
}

/** Slides ascending; the unstamped ones last, since they belong to no slide. */
function groupByPage(entries: ExportEntry[]): Array<{
  heading: string;
  entries: ExportEntry[];
}> {
  const byPage = new Map<number | null, ExportEntry[]>();
  for (const entry of entries) {
    const key = entry.page ?? null;
    const bucket = byPage.get(key);
    if (bucket) bucket.push(entry);
    else byPage.set(key, [entry]);
  }

  const stamped = [...byPage.keys()]
    .filter((page): page is number => page !== null)
    .sort((a, b) => a - b);

  const groups = stamped.map((page) => ({
    heading: `Slide ${page}`,
    entries: sortByTime(byPage.get(page) ?? []),
  }));

  const unstamped = byPage.get(null);
  if (unstamped?.length) {
    groups.push({
      heading: UNSTAMPED_HEADING,
      entries: sortByTime(unstamped),
    });
  }
  return groups;
}

function sortByTime<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Build the Markdown file. Lectures run oldest-first so the export reads
 * forwards, the way the semester happened.
 */
export function buildNotesMarkdown(input: NotesExportInput): string {
  const timeZone = safeZone(input.timeZone);
  const courseName = input.courseName.trim() || "Course";

  const lectures = input.lectures
    .filter((lecture) => lecture.entries.length > 0)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const lines: string[] = [
    "---",
    "source: ClassAct",
    "type: lecture-notes",
    `version: ${NOTES_EXPORT_VERSION}`,
    `course: ${yamlQuote(courseName)}`,
    `exported: ${input.exportedAt}`,
    `lectures: ${lectures.length}`,
    "---",
    "",
    `# ${courseName} — Lecture Notes`,
  ];

  if (lectures.length === 0) {
    lines.push("", "_No notes yet._", "");
    return lines.join("\n");
  }

  for (const lecture of lectures) {
    const day = formatDay(lecture.startedAt, timeZone);
    const title = lecture.deckTitle.trim();
    lines.push("", `## ${day}${title ? ` — ${title}` : ""}`);

    for (const group of groupByPage(lecture.entries)) {
      lines.push("", `### ${group.heading}`, "");
      for (const entry of group.entries) {
        lines.push(renderEntry(entry, timeZone));
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

/** `Managing in the AI Era` → `classact-notes-managing-in-the-ai-era.md` */
export function notesFilename(courseName: string, forDate?: string): string {
  const slug = courseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const parts = ["classact-notes", slug || "course"];
  if (forDate) {
    const dateSlug = forDate
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (dateSlug) parts.push(dateSlug);
  }
  return `${parts.join("-")}.md`;
}
