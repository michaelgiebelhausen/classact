import { describe, expect, it } from "vitest";
import { submissionStatus } from "@/lib/submissionstatus";

const deadline = "2026-09-10T23:59:00.000Z";

describe("submissionStatus", () => {
  it("is submitted (on time) when the submission precedes the deadline", () => {
    const s = submissionStatus({
      deadline,
      submittedAt: "2026-09-09T12:00:00.000Z",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });
    expect(s).toEqual({
      kind: "submitted",
      late: false,
      submittedAt: "2026-09-09T12:00:00.000Z",
    });
  });

  it("is submitted but late when handed in after the deadline", () => {
    const s = submissionStatus({
      deadline,
      submittedAt: "2026-09-11T01:00:00.000Z",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });
    expect(s.kind).toBe("submitted");
    expect(s.late).toBe(true);
  });

  it("is due when nothing is in and the deadline is ahead", () => {
    const s = submissionStatus({
      deadline,
      submittedAt: null,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(s).toEqual({ kind: "due", late: false, submittedAt: null });
  });

  it("is missing when nothing is in and the deadline has passed", () => {
    const s = submissionStatus({
      deadline,
      submittedAt: undefined,
      now: new Date("2026-09-12T00:00:00.000Z"),
    });
    expect(s.kind).toBe("missing");
  });
});
