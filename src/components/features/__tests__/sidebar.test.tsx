import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/features/Sidebar";

/**
 * The rail holds fourteen links. Stacked, they are taller than the usable
 * height of a 1366x768 laptop, which is what most of the room is on. The
 * rail is pinned to the viewport, so unless it scrolls on its own, the
 * bottom of it (Assignments, Profile) is simply unreachable; a longer main
 * column does not help because the rail stays pinned while the page moves.
 * jsdom does no layout, so this guards the declaration, not the pixels.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/course/c1/checkin",
}));

describe("Sidebar", () => {
  test("the rail is its own vertical scroll container", () => {
    render(<Sidebar />);
    const rail = screen.getByRole("navigation");
    expect(rail.className).toMatch(/\boverflow-y-auto\b/);
    expect(rail.className).not.toMatch(/\boverflow-visible\b/);
    // Assignments must be in the rail at all, and reachable by scrolling it.
    expect(screen.getByRole("link", { name: /assignments/i })).toBeTruthy();
  });
});
