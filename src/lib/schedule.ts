/**
 * Class schedule (pure, no I/O): when a course meets, and whether "now"
 * falls inside the auto-open window. All decisions are made in the course's
 * own IANA timezone via Intl, so a professor in New York and a server in
 * UTC agree on what "9:30 AM Monday" means.
 *
 * Auto-open starts a little before class (students arrive early); it does
 * not auto-close — the session naturally scopes to its calendar date, and
 * professors who run long keep control.
 */

export interface CourseSchedule {
  /** Weekdays the class meets, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** "HH:MM" (24h) or "HH:MM:SS" as Postgres returns `time`. */
  start: string;
  end: string;
  /** IANA timezone, e.g. "America/New_York". */
  timezone: string;
}

/** Check-in opens this many minutes before the scheduled start. */
export const OPEN_EARLY_MINUTES = 15;

const DAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** "09:30" | "09:30:00" → minutes past midnight; null if unparsable. */
export function parseTimeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** A moment's weekday + minutes-past-midnight + date, in a target timezone. */
export function zonedParts(
  now: Date,
  timezone: string
): { day: number; minutes: number; date: string } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    // Unknown timezone string → fall back to UTC rather than crash.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((p) => [p.type, p.value])
  );
  // en-CA hour "24" can appear for midnight in some runtimes; normalize.
  const hour = Number(parts.hour) % 24;
  return {
    day: DAY_INDEX[parts.weekday] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Is `now` inside the auto-open window (start − 15 min → end) on a meeting day? */
export function isMeetingWindow(schedule: CourseSchedule, now: Date): boolean {
  const start = parseTimeToMinutes(schedule.start);
  const end = parseTimeToMinutes(schedule.end);
  if (start === null || end === null || end <= start) return false;
  if (schedule.days.length === 0) return false;
  const local = zonedParts(now, schedule.timezone);
  if (!schedule.days.includes(local.day)) return false;
  return local.minutes >= start - OPEN_EARLY_MINUTES && local.minutes < end;
}

/** Today's date (YYYY-MM-DD) in the course's timezone — the session key. */
export function sessionDateFor(schedule: CourseSchedule, now: Date): string {
  return zonedParts(now, schedule.timezone).date;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(value: string): string {
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) return value;
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "Mon, Wed, Fri · 9:30 AM–10:20 AM" for empty states and the setup tab. */
export function formatSchedule(schedule: CourseSchedule): string {
  const days = [...schedule.days]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .map((d) => DAY_SHORT[d])
    .join(", ");
  if (!days) return "";
  return `${days} · ${formatTime(schedule.start)}–${formatTime(schedule.end)}`;
}

/** Valid, complete, and auto-openable? (Shared by UI + server action.) */
export function isScheduleComplete(input: {
  days: number[];
  start: string | null;
  end: string | null;
  timezone: string | null;
}): input is { days: number[]; start: string; end: string; timezone: string } {
  if (!input.start || !input.end || !input.timezone) return false;
  const start = parseTimeToMinutes(input.start);
  const end = parseTimeToMinutes(input.end);
  return (
    input.days.length > 0 &&
    input.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    start !== null &&
    end !== null &&
    end > start
  );
}
