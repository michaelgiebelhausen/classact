"use client";

import { useSyncExternalStore } from "react";

/**
 * A timestamp shown in the viewer's own timezone.
 *
 * Server components ran `toLocaleString()` directly, which formats in the
 * *server's* timezone — UTC on Vercel. A deadline set for 11:59 PM Eastern
 * rendered as "8/27, 3:59 AM", four hours late and on the wrong day. A
 * student reading that reasonably concludes they have until the following
 * morning; submitWork then refuses the upload, and they lose the grade to a
 * display bug. There is no server-side fix, because the server cannot know
 * where the reader is.
 *
 * So the formatting happens after mount, in the browser, where the timezone
 * is actually known. The first render is deliberately empty rather than a
 * UTC guess: a blank that fills in within a frame is honest, and a wrong
 * time that corrects itself is not. Server and first client render agree on
 * that blank, so there is no hydration mismatch either.
 *
 * The `dateTime` attribute always carries the exact instant, so the machine
 * -readable value is correct even before the text appears.
 */

export type LocalTimeVariant =
  /** 8/26/2026, 11:59:00 PM — full precision, for deadlines. */
  | "full"
  /** Aug 26, 11:59 PM — compact, for dense lists and rosters. */
  | "short"
  /** August 26, 2026 — no clock time. */
  | "date"
  /** 11:59 PM — clock only, for things stamped within a single sitting. */
  | "time";

const FORMATS: Record<LocalTimeVariant, Intl.DateTimeFormatOptions | undefined> = {
  full: undefined,
  short: {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  date: { year: "numeric", month: "long", day: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
};

interface Props {
  /** ISO 8601 timestamp. */
  iso: string;
  variant?: LocalTimeVariant;
  className?: string;
}

/** Never resubscribes — "are we on the client yet" changes exactly once. */
const subscribe = () => () => {};

export function LocalTime({ iso, variant = "full", className }: Props) {
  // false while server-rendering and on the hydrating render, true after.
  // useSyncExternalStore is the supported way to differ between the two
  // without a setState-in-effect cascade or a hydration mismatch.
  const onClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

  const date = new Date(iso);
  const text =
    onClient && !Number.isNaN(date.getTime())
      ? date.toLocaleString(undefined, FORMATS[variant])
      : "";

  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
