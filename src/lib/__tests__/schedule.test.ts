import { describe, expect, it } from "vitest";
import {
  formatSchedule,
  formatTerm,
  isMeetingWindow,
  isScheduleComplete,
  isWithinTerm,
  parseTimeToMinutes,
  sessionDateFor,
  zonedParts,
  type CourseSchedule,
} from "@/lib/schedule";

// MWF 9:30–10:20 AM Eastern. 2026-07-20 is a Monday; EDT is UTC−4.
const MWF: CourseSchedule = {
  days: [1, 3, 5],
  start: "09:30",
  end: "10:20",
  timezone: "America/New_York",
};

const utc = (iso: string) => new Date(iso);

describe("term bounds", () => {
  // Monday 2026-07-20, 9:35 AM Eastern — inside the meeting window.
  const during = utc("2026-07-20T13:35:00Z");

  it("is unbounded when no dates are set", () => {
    expect(isWithinTerm(MWF, "2019-01-01")).toBe(true);
    expect(isMeetingWindow(MWF, during)).toBe(true);
  });

  it("includes the first and last day of term", () => {
    const term = { ...MWF, termStart: "2026-07-20", termEnd: "2026-07-20" };
    expect(isWithinTerm(term, "2026-07-20")).toBe(true);
    expect(isMeetingWindow(term, during)).toBe(true);
  });

  it("stays shut before term starts and after it ends", () => {
    expect(isMeetingWindow({ ...MWF, termStart: "2026-08-24" }, during)).toBe(false);
    expect(isMeetingWindow({ ...MWF, termEnd: "2026-07-19" }, during)).toBe(false);
    expect(isWithinTerm({ ...MWF, termEnd: "2026-07-19" }, "2026-07-20")).toBe(false);
  });

  it("formats the range without timezone drift", () => {
    expect(formatTerm({ ...MWF, termStart: "2026-08-21", termEnd: "2026-12-05" })).toBe(
      "Aug 21 – Dec 5"
    );
    expect(formatTerm({ ...MWF, termStart: "2026-01-01" })).toBe("from Jan 1");
    expect(formatTerm({ ...MWF, termEnd: "2026-12-31" })).toBe("through Dec 31");
    expect(formatTerm(MWF)).toBe("");
  });
});

describe("parseTimeToMinutes", () => {
  it("parses HH:MM and Postgres HH:MM:SS", () => {
    expect(parseTimeToMinutes("09:30")).toBe(570);
    expect(parseTimeToMinutes("09:30:00")).toBe(570);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
  });
  it("rejects garbage", () => {
    expect(parseTimeToMinutes("25:00")).toBeNull();
    expect(parseTimeToMinutes("nope")).toBeNull();
  });
});

describe("zonedParts", () => {
  it("converts UTC to the course timezone", () => {
    const parts = zonedParts(utc("2026-07-20T13:30:00Z"), "America/New_York");
    expect(parts.day).toBe(1); // Monday
    expect(parts.minutes).toBe(9 * 60 + 30);
    expect(parts.date).toBe("2026-07-20");
  });
  it("crosses date lines correctly", () => {
    // 1:00 UTC Monday = Sunday evening in New York.
    const parts = zonedParts(utc("2026-07-20T01:00:00Z"), "America/New_York");
    expect(parts.day).toBe(0);
    expect(parts.date).toBe("2026-07-19");
  });
  it("falls back to UTC on a bad timezone instead of throwing", () => {
    const parts = zonedParts(utc("2026-07-20T13:30:00Z"), "Not/AZone");
    expect(parts.minutes).toBe(13 * 60 + 30);
  });
});

describe("isMeetingWindow", () => {
  it("opens 15 minutes early and through the end of class", () => {
    // 9:14 AM EDT — one minute too early.
    expect(isMeetingWindow(MWF, utc("2026-07-20T13:14:00Z"))).toBe(false);
    // 9:15 AM — grace window opens.
    expect(isMeetingWindow(MWF, utc("2026-07-20T13:15:00Z"))).toBe(true);
    // 10:19 AM — still open.
    expect(isMeetingWindow(MWF, utc("2026-07-20T14:19:00Z"))).toBe(true);
    // 10:20 AM — class over.
    expect(isMeetingWindow(MWF, utc("2026-07-20T14:20:00Z"))).toBe(false);
  });
  it("closed on non-meeting days", () => {
    // Tuesday 9:30 AM EDT.
    expect(isMeetingWindow(MWF, utc("2026-07-21T13:30:00Z"))).toBe(false);
  });
  it("closed when the schedule is malformed", () => {
    expect(isMeetingWindow({ ...MWF, days: [] }, utc("2026-07-20T13:30:00Z"))).toBe(false);
    expect(
      isMeetingWindow({ ...MWF, start: "11:00", end: "09:00" }, utc("2026-07-20T13:30:00Z"))
    ).toBe(false);
  });
});

describe("sessionDateFor", () => {
  it("uses the course timezone's calendar date, not the server's", () => {
    // 2:00 UTC Tuesday is still Monday evening in New York.
    expect(sessionDateFor(MWF, utc("2026-07-21T02:00:00Z"))).toBe("2026-07-20");
  });
});

describe("formatSchedule / isScheduleComplete", () => {
  it("formats a readable summary", () => {
    expect(formatSchedule(MWF)).toBe("Mon, Wed, Fri · 9:30 AM–10:20 AM");
  });
  it("validates completeness", () => {
    expect(
      isScheduleComplete({ days: [1, 3], start: "09:30", end: "10:20", timezone: "America/New_York" })
    ).toBe(true);
    expect(isScheduleComplete({ days: [], start: "09:30", end: "10:20", timezone: "UTC" })).toBe(false);
    expect(isScheduleComplete({ days: [1], start: null, end: "10:20", timezone: "UTC" })).toBe(false);
    expect(
      isScheduleComplete({ days: [1], start: "11:00", end: "10:00", timezone: "UTC" })
    ).toBe(false);
  });
});
