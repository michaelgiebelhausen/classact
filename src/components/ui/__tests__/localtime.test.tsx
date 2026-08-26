import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocalTime } from "@/components/ui/localtime";

/**
 * The bug this guards: a deadline stored as 2026-08-27T03:59:00Z is 11:59 PM
 * on 8/26 in Eastern time. Rendered on the server (UTC) it read
 * "8/27/2026, 3:59:00 AM" — four hours late, on the wrong day — and a
 * student who believed it would be locked out.
 *
 * jsdom inherits the process timezone, which vitest pins via TZ in the
 * setup file if set; these assertions avoid depending on a specific zone
 * and instead check the property that actually matters: the rendered text
 * matches what the *local* environment formats, not what UTC formats.
 */

const DEADLINE = "2026-08-27T03:59:00.000Z";

describe("LocalTime", () => {
  test("renders the timestamp in the local timezone, not UTC", () => {
    render(<LocalTime iso={DEADLINE} />);

    const expected = new Date(DEADLINE).toLocaleString();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  test("differs from the UTC rendering whenever the zone isn't UTC", () => {
    render(<LocalTime iso={DEADLINE} />);

    const localText = new Date(DEADLINE).toLocaleString();
    const utcText = new Date(DEADLINE).toLocaleString("en-US", {
      timeZone: "UTC",
    });
    const offset = new Date(DEADLINE).getTimezoneOffset();

    // The assertion only bites when the test env isn't UTC; in UTC the two
    // are legitimately identical and there is nothing to catch.
    if (offset !== 0) {
      expect(localText).not.toBe(utcText);
    }
    expect(screen.getByText(localText)).toBeInTheDocument();
  });

  test("always carries the exact instant in the dateTime attribute", () => {
    const { container } = render(<LocalTime iso={DEADLINE} />);
    const el = container.querySelector("time");

    expect(el).not.toBeNull();
    expect(el?.getAttribute("dateTime")).toBe(DEADLINE);
  });

  test("the short variant omits the year and seconds", () => {
    render(<LocalTime iso={DEADLINE} variant="short" />);

    const expected = new Date(DEADLINE).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  test("the date variant omits the clock time", () => {
    render(<LocalTime iso={DEADLINE} variant="date" />);

    const expected = new Date(DEADLINE).toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  test("renders empty rather than 'Invalid Date' for a bad timestamp", () => {
    const { container } = render(<LocalTime iso="not-a-date" />);
    const el = container.querySelector("time");

    expect(el?.textContent).toBe("");
  });

  test("applies a className so callers keep their styling", () => {
    const { container } = render(
      <LocalTime iso={DEADLINE} className="text-destructive" />
    );

    expect(container.querySelector("time")?.className).toBe("text-destructive");
  });
});
