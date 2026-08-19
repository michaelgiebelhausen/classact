import { describe, expect, it } from "vitest";
import {
  formatSchedule,
  formatTerm,
  isMeetingWindow,
  isScheduleComplete,
  isWithinTerm,
  meetingStartInstant,
  parseTimeToMinutes,
  recentMeetingDates,
  sessionDateFor,
  upcomingMeetingDates,
  zonedDateTimeToUtc,
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

describe("zonedDateTimeToUtc", () => {
  it("converts an Eastern wall-clock time to the right instant in summer (EDT, UTC-4)", () => {
    expect(zonedDateTimeToUtc("2026-07-20", 9 * 60 + 30, "America/New_York").toISOString()).toBe(
      "2026-07-20T13:30:00.000Z"
    );
  });

  it("and in winter (EST, UTC-5)", () => {
    expect(zonedDateTimeToUtc("2026-01-12", 9 * 60 + 30, "America/New_York").toISOString()).toBe(
      "2026-01-12T14:30:00.000Z"
    );
  });

  it("is right on the DST-change day itself", () => {
    // US clocks spring forward 2026-03-08 at 2 AM; a 9:30 AM class that day is EDT.
    expect(zonedDateTimeToUtc("2026-03-08", 9 * 60 + 30, "America/New_York").toISOString()).toBe(
      "2026-03-08T13:30:00.000Z"
    );
    // And fall back 2026-11-01; 9:30 AM that day is EST.
    expect(zonedDateTimeToUtc("2026-11-01", 9 * 60 + 30, "America/New_York").toISOString()).toBe(
      "2026-11-01T14:30:00.000Z"
    );
  });

  it("handles zones ahead of UTC and unknown zones (UTC fallback)", () => {
    expect(zonedDateTimeToUtc("2026-07-20", 9 * 60, "Asia/Kolkata").toISOString()).toBe(
      "2026-07-20T03:30:00.000Z"
    );
    expect(zonedDateTimeToUtc("2026-07-20", 9 * 60, "Not/AZone").toISOString()).toBe(
      "2026-07-20T09:00:00.000Z"
    );
  });
});

describe("meetingStartInstant", () => {
  it("is the class start on that date in the course zone", () => {
    expect(meetingStartInstant(MWF, "2026-07-22")?.toISOString()).toBe("2026-07-22T13:30:00.000Z");
  });

  it("is null without a parsable start time", () => {
    expect(meetingStartInstant({ ...MWF, start: "" }, "2026-07-22")).toBeNull();
  });
});

describe("upcomingMeetingDates", () => {
  // Monday 2026-07-20, 8:00 AM Eastern — before class.
  const mondayMorning = utc("2026-07-20T12:00:00Z");

  it("starts with today when class hasn't ended, then follows the pattern", () => {
    expect(upcomingMeetingDates(MWF, mondayMorning, 4)).toEqual([
      "2026-07-20",
      "2026-07-22",
      "2026-07-24",
      "2026-07-27",
    ]);
  });

  it("skips today once class is over", () => {
    // Monday 11:00 AM Eastern — class ended at 10:20.
    const mondayLate = utc("2026-07-20T15:00:00Z");
    expect(upcomingMeetingDates(MWF, mondayLate, 2)).toEqual(["2026-07-22", "2026-07-24"]);
  });

  it("respects term bounds", () => {
    const bounded = { ...MWF, termStart: "2026-07-22", termEnd: "2026-07-24" };
    expect(upcomingMeetingDates(bounded, mondayMorning, 10)).toEqual(["2026-07-22", "2026-07-24"]);
  });

  it("uses the course zone for 'today', not UTC", () => {
    // 11 PM Sunday Eastern is already Monday in UTC. Today in the course
    // zone is still Sunday, so Monday is the next class.
    const sundayNight = utc("2026-07-20T03:00:00Z");
    expect(upcomingMeetingDates(MWF, sundayNight, 1)).toEqual(["2026-07-20"]);
  });

  it("is empty with no meeting days", () => {
    expect(upcomingMeetingDates({ ...MWF, days: [] }, mondayMorning)).toEqual([]);
  });
});

describe("recentMeetingDates", () => {
  it("offers classes already missed, newest first", () => {
    // Friday 2026-07-24, 11:00 AM Eastern — after that day's class ended.
    const fridayAfter = utc("2026-07-24T15:00:00Z");
    expect(recentMeetingDates(MWF, fridayAfter, 7)).toEqual([
      "2026-07-24",
      "2026-07-22",
      "2026-07-20",
      "2026-07-17",
    ]);
  });

  it("excludes today while class is still ahead — that's 'upcoming', not 'missed'", () => {
    // Friday 8:00 AM Eastern, class at 9:30.
    const fridayBefore = utc("2026-07-24T12:00:00Z");
    const recent = recentMeetingDates(MWF, fridayBefore, 7);
    expect(recent).not.toContain("2026-07-24");
    expect(recent[0]).toBe("2026-07-22");
    // And it IS offered as upcoming, so the day is never unreachable.
    expect(upcomingMeetingDates(MWF, fridayBefore, 1)).toEqual(["2026-07-24"]);
  });

  it("stops at the start of term", () => {
    const bounded = { ...MWF, termStart: "2026-07-22" };
    expect(recentMeetingDates(bounded, utc("2026-07-24T15:00:00Z"), 14)).toEqual([
      "2026-07-24",
      "2026-07-22",
    ]);
  });

  it("is empty with no meeting days or a zero window", () => {
    expect(recentMeetingDates({ ...MWF, days: [] }, utc("2026-07-24T15:00:00Z"))).toEqual([]);
    expect(recentMeetingDates(MWF, utc("2026-07-24T15:00:00Z"), 0)).toEqual([]);
  });
});

