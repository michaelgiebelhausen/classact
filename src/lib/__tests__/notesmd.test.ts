import { describe, expect, test } from "vitest";
import {
  buildNotesMarkdown,
  notesFilename,
  type ExportLecture,
} from "@/lib/notesmd";

// A fixed zone everywhere: an export that reads differently on the grader's
// machine than the student's is a bug, and a test that only passes in one
// timezone wouldn't catch it.
const TZ = "America/New_York";

function entry(page: number | null, content: string, createdAt: string) {
  return { page, content, createdAt };
}

const lecture: ExportLecture = {
  startedAt: "2026-08-12T14:00:00.000Z",
  deckTitle: "Intro to Agents",
  entries: [
    entry(4, "Agents are just loops with tools.", "2026-08-12T14:04:00.000Z"),
    entry(7, "Ask about the eval slide.", "2026-08-12T14:12:00.000Z"),
  ],
};

function build(lectures: ExportLecture[], courseName = "Managing in the AI Era") {
  return buildNotesMarkdown({
    courseName,
    exportedAt: "2026-08-28T15:04:00.000Z",
    timeZone: TZ,
    lectures,
  });
}

describe("buildNotesMarkdown", () => {
  test("opens with frontmatter a notes vault can read", () => {
    const md = build([lecture]);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("source: ClassAct");
    expect(md).toContain("type: lecture-notes");
    expect(md).toContain('course: "Managing in the AI Era"');
    expect(md).toContain("exported: 2026-08-28T15:04:00.000Z");
    expect(md).toContain("lectures: 1");
  });

  test("escapes quotes in the course name so the frontmatter stays valid YAML", () => {
    const md = build([lecture], 'The "Real" World');
    expect(md).toContain('course: "The \\"Real\\" World"');
  });

  test("heads each lecture with its date and deck title", () => {
    // 14:00Z is 10:00 in New York — the date must be rendered in the zone,
    // not read off the ISO string.
    expect(build([lecture])).toContain("## Aug 12, 2026 — Intro to Agents");
  });

  test("files entries under their slide, ascending", () => {
    const md = build([
      {
        ...lecture,
        entries: [
          entry(7, "second slide note", "2026-08-12T14:12:00.000Z"),
          entry(4, "first slide note", "2026-08-12T14:04:00.000Z"),
        ],
      },
    ]);
    expect(md.indexOf("### Slide 4")).toBeGreaterThan(-1);
    expect(md.indexOf("### Slide 4")).toBeLessThan(md.indexOf("### Slide 7"));
  });

  test("stamps each entry with the local time", () => {
    expect(build([lecture])).toContain(
      "- 10:04 AM — Agents are just loops with tools."
    );
  });

  test("puts unstamped notes last, under General notes", () => {
    const md = build([
      {
        ...lecture,
        entries: [
          entry(null, "imported freeform note", "2026-08-12T14:01:00.000Z"),
          entry(4, "slide note", "2026-08-12T14:04:00.000Z"),
        ],
      },
    ]);
    // Even though it was written first, it belongs to no slide.
    expect(md.indexOf("### Slide 4")).toBeLessThan(
      md.indexOf("### General notes")
    );
  });

  test("keeps a multi-line note inside its bullet", () => {
    const md = build([
      {
        ...lecture,
        entries: [
          entry(4, "first line\nsecond line", "2026-08-12T14:04:00.000Z"),
        ],
      },
    ]);
    expect(md).toContain("- 10:04 AM — first line\n  second line");
  });

  test("leaves a blank line inside a note blank rather than indented", () => {
    const md = build([
      {
        ...lecture,
        entries: [entry(4, "para one\n\npara two", "2026-08-12T14:04:00.000Z")],
      },
    ]);
    expect(md).toContain("- 10:04 AM — para one\n\n  para two");
    expect(md).not.toMatch(/ +\n/);
  });

  test("orders entries within a slide chronologically", () => {
    const md = build([
      {
        ...lecture,
        entries: [
          entry(4, "later", "2026-08-12T14:20:00.000Z"),
          entry(4, "earlier", "2026-08-12T14:04:00.000Z"),
        ],
      },
    ]);
    expect(md.indexOf("earlier")).toBeLessThan(md.indexOf("later"));
  });

  test("runs lectures oldest first, so the export reads like the semester", () => {
    const later: ExportLecture = {
      startedAt: "2026-08-19T14:00:00.000Z",
      deckTitle: "Evals",
      entries: [entry(1, "note", "2026-08-19T14:05:00.000Z")],
    };
    const md = build([later, lecture]);
    expect(md.indexOf("Intro to Agents")).toBeLessThan(md.indexOf("Evals"));
    expect(md).toContain("lectures: 2");
  });

  test("omits lectures nobody took notes in", () => {
    const md = build([lecture, { ...lecture, deckTitle: "Empty", entries: [] }]);
    expect(md).not.toContain("Empty");
    expect(md).toContain("lectures: 1");
  });

  test("says so plainly when there is nothing to export", () => {
    const md = build([]);
    expect(md).toContain("lectures: 0");
    expect(md).toContain("_No notes yet._");
  });

  test("falls back to UTC rather than throwing on a bad timezone", () => {
    const md = buildNotesMarkdown({
      courseName: "Course",
      exportedAt: "2026-08-28T15:04:00.000Z",
      timeZone: "Not/AZone",
      lectures: [lecture],
    });
    expect(md).toContain("## Aug 12, 2026");
  });

  test("never emits the narrow no-break space Intl likes before AM", () => {
    // Whether ICU hands back U+202F here depends on the Node build, so assert
    // on the output rather than trusting this machine's answer.
    expect(build([lecture])).not.toMatch(/[  ]/);
    expect(
      buildNotesMarkdown({
        courseName: "Course",
        exportedAt: "2026-08-28T15:04:00.000Z",
        timeZone: TZ,
        lectures: [
          {
            ...lecture,
            entries: [entry(1, "note", "2026-08-12T14:04:00.000Z")],
          },
        ],
      })
    ).toContain("- 10:04 AM — note");
  });
});

describe("a whole exported document", () => {
  // The assertions above each guard one rule; this one is here so a change to
  // the shape of the file is visible as a shape, which is how anyone reading
  // the export will actually encounter it.
  test("reads the way a student would want to find it later", () => {
    expect(
      build([
        {
          startedAt: "2026-08-12T14:00:00.000Z",
          deckTitle: "Intro to Agents",
          entries: [
            entry(null, "imported from the old notes box", "2026-08-12T13:59:00.000Z"),
            entry(4, "Agents are just loops with tools.", "2026-08-12T14:04:00.000Z"),
            entry(4, "Two things here:\n\nthe loop, and the tools", "2026-08-12T14:06:00.000Z"),
            entry(7, "Ask about the eval slide.", "2026-08-12T14:12:00.000Z"),
          ],
        },
      ])
    ).toMatchInlineSnapshot(`
      "---
      source: ClassAct
      type: lecture-notes
      version: 1
      course: "Managing in the AI Era"
      exported: 2026-08-28T15:04:00.000Z
      lectures: 1
      ---

      # Managing in the AI Era — Lecture Notes

      ## Aug 12, 2026 — Intro to Agents

      ### Slide 4

      - 10:04 AM — Agents are just loops with tools.
      - 10:06 AM — Two things here:

        the loop, and the tools

      ### Slide 7

      - 10:12 AM — Ask about the eval slide.

      ### General notes

      - 9:59 AM — imported from the old notes box
      "
    `);
  });
});

describe("notesFilename", () => {
  test("slugs the course name", () => {
    expect(notesFilename("Managing in the AI Era")).toBe(
      "classact-notes-managing-in-the-ai-era.md"
    );
  });

  test("appends a date when the export is one lecture", () => {
    expect(notesFilename("BUS 4990", "2026-08-12")).toBe(
      "classact-notes-bus-4990-2026-08-12.md"
    );
  });

  test("survives a course name with nothing sluggable in it", () => {
    expect(notesFilename("!!!")).toBe("classact-notes-course.md");
  });
});
