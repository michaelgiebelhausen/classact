import { describe, expect, test } from "vitest";
import {
  depthScale,
  flipX,
  flipY,
  fitScale,
  offsetDirection,
  FRONT_SCALE,
  BACK_SCALE,
} from "@/lib/mapview";

describe("flipY", () => {
  test("puts the front row at the bottom for the professor", () => {
    // Seat coords run +y away from the front, so the student view draws the
    // front at the top. The professor stands there and looks the other way.
    expect(flipY(0, 0, 4)).toBe(4);
    expect(flipY(4, 0, 4)).toBe(0);
  });

  test("leaves coordinates alone when not flipped", () => {
    expect(flipY(1, 0, 4, false)).toBe(1);
  });

  test("handles a single-row room without dividing by zero", () => {
    expect(flipY(2, 2, 2)).toBe(2);
  });
});

describe("flipX", () => {
  test("swaps left and right when the room is turned around", () => {
    // Turning to face the class is a 180-degree rotation, and a rotation
    // flips BOTH axes. Flipping only the depth axis gives a mirror image:
    // the student on the professor's right renders on the screen's left.
    expect(flipX(0, 0, 7)).toBe(7);
    expect(flipX(7, 0, 7)).toBe(0);
    expect(flipX(2, 0, 7)).toBe(5);
  });

  test("leaves coordinates alone when not flipped", () => {
    expect(flipX(2, 0, 7, false)).toBe(2);
  });

  test("handles a single-column room without dividing by zero", () => {
    expect(flipX(3, 3, 3)).toBe(3);
  });
});

describe("depthScale", () => {
  test("makes the front row largest and the back row smallest", () => {
    const front = depthScale(0, 0, 4);
    const back = depthScale(4, 0, 4);
    expect(front).toBeCloseTo(FRONT_SCALE, 5);
    expect(back).toBeCloseTo(BACK_SCALE, 5);
    expect(front).toBeGreaterThan(back);
  });

  test("scales smoothly in between", () => {
    const mid = depthScale(2, 0, 4);
    expect(mid).toBeLessThan(FRONT_SCALE);
    expect(mid).toBeGreaterThan(BACK_SCALE);
  });

  test("never shrinks the back row below legibility", () => {
    // A ten-row lecture hall must still have readable faces at the back.
    expect(depthScale(9, 0, 9)).toBeGreaterThanOrEqual(0.7);
  });

  test("a single-row room gets no perspective distortion", () => {
    expect(depthScale(3, 3, 3)).toBe(1);
  });
});

describe("fitScale", () => {
  test("shrinks a room that overflows its container", () => {
    expect(fitScale(1000, 500, 500, 500)).toBeCloseTo(0.5, 5);
  });

  test("uses the tighter of the two axes", () => {
    // Wide enough but not tall enough: height decides.
    expect(fitScale(400, 1000, 800, 500)).toBeCloseTo(0.5, 5);
  });

  test("never enlarges past its natural size", () => {
    // Growing a small room to fill a projector turns 36px seats into
    // billboards and looks broken.
    expect(fitScale(200, 200, 1000, 1000)).toBe(1);
  });

  test("copes with a container that hasn't been measured yet", () => {
    expect(fitScale(500, 500, 0, 0)).toBe(1);
  });
});

describe("offsetDirection", () => {
  test("reverses a room-space offset when the map is turned around", () => {
    // A table footprint nudges the surface away from its seats. On a rotated
    // map that nudge has to reverse, or the table lands on the students.
    expect(offsetDirection(true)).toBe(-1);
  });

  test("leaves it alone on the student's map", () => {
    expect(offsetDirection(false)).toBe(1);
  });
});
