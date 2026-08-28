/**
 * Geometry for the two ways a room can be looked at.
 *
 * Seat coordinates run `+y away from the front`, which draws the front of the
 * room at the top — right for a student holding a phone and reading down into
 * the room. It is exactly wrong for the professor, who is standing at the
 * front looking the other way, and it is how at least one student ended up
 * checking into somebody else's seat.
 *
 * So the professor's map is flipped, and given depth: the front row is nearest
 * them and drawn largest, the back row furthest and smallest. That mirrors
 * what they actually see when they look up.
 */

/** Scale applied to the row nearest the viewer, and the row furthest away. */
export const FRONT_SCALE = 1.3;
export const BACK_SCALE = 0.78;

/**
 * Mirror a seat across the room's width, so the student on the professor's
 * right is drawn on the right of their screen.
 *
 * This is the other half of turning around. Facing the class is a 180-degree
 * ROTATION, which flips depth *and* width; flipping only depth gives a mirror
 * image, with everyone on the wrong side. Shipped that way once — the
 * professor spotted it from the room, holding a seating chart that had two
 * students swapped.
 */
export function flipX(
  x: number,
  minX: number,
  maxX: number,
  flipped = true
): number {
  if (!flipped) return x;
  return maxX - (x - minX);
}

/**
 * Mirror a seat's depth so the front of the room lands at the bottom.
 *
 * Returns a coordinate in the same space, so everything downstream — tables,
 * row letters, the balcony divider — flips with the seats rather than needing
 * its own special case.
 */
export function flipY(
  y: number,
  minY: number,
  maxY: number,
  flipped = true
): number {
  if (!flipped) return y;
  return maxY - (y - minY);
}

/**
 * How much to scale a seat for its distance from the viewer.
 *
 * `y` is the seat's ORIGINAL depth: 0 = front of room. The professor is at the
 * front, so low y is near them and gets FRONT_SCALE.
 *
 * A room with one row of seats gets no perspective at all — there is no depth
 * to convey, and scaling the only row would just make it arbitrarily large.
 */
export function depthScale(y: number, minY: number, maxY: number): number {
  const span = maxY - minY;
  if (span <= 0) return 1;
  const depth = (y - minY) / span; // 0 at the front, 1 at the back
  return FRONT_SCALE + (BACK_SCALE - FRONT_SCALE) * depth;
}

/**
 * Scale the whole room to fit the space it has.
 *
 * Shrink-only. A projected map must never scroll — the back row would be lost
 * off-screen halfway through class — but blowing a small seminar room up to
 * fill a projector turns 36px seats into billboards, so growth is refused.
 * An unmeasured container (both zero, first render) scales by 1 rather than
 * collapsing to nothing.
 */
export function fitScale(
  contentW: number,
  contentH: number,
  containerW: number,
  containerH: number
): number {
  if (containerW <= 0 || containerH <= 0) return 1;
  if (contentW <= 0 || contentH <= 0) return 1;
  return Math.min(1, containerW / contentW, containerH / contentH);
}

/**
 * Which way a room-space offset points once the map is turned around.
 *
 * Table footprints carry a correction vector — "step back from the seat
 * centroid" — expressed in room space, while the renderer adds it to
 * already-flipped screen pixels. Rotating the room reverses both axes, so the
 * vector must reverse with them. Added unchanged it moves the table by twice
 * the correction in the wrong direction and parks it on top of the students
 * sitting around it, which is exactly how it shipped.
 */
export function offsetDirection(flipped: boolean): 1 | -1 {
  return flipped ? -1 : 1;
}
