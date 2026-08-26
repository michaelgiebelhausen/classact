/**
 * Leaving the professor role.
 *
 * A student who taps "professor" at sign-up lands in a one-way door: the
 * professor side has no join-a-class path, so every later sign-in drops them
 * on "build your course" and they can never reach the student view. Clearing
 * cookies does nothing — the role is on their profile row, not in the browser.
 * Three students were sitting in that state during the Fall 2026 pilot, all
 * three already holding an active enrollment in the class they could not see.
 *
 * The one thing this must not do is let a real professor demote themselves out
 * from under a class that is running.
 */

export interface RoleChangeInputs {
  coursesTaught: number;
  /** Non-dropped enrollments across every course they own. */
  studentsEnrolled: number;
}

export type RoleChangeVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Gated on enrolled students rather than on owning courses at all.
 *
 * A course nobody has joined is an abandoned draft; refusing to release the
 * role over one would trap exactly the people this exists for — someone who
 * tapped "professor", got dropped onto the course-builder, and made a course
 * before working out that they were in the wrong place entirely.
 */
export function canLeaveProfessorRole(
  inputs: RoleChangeInputs
): RoleChangeVerdict {
  if (inputs.studentsEnrolled > 0) {
    return {
      allowed: false,
      reason:
        `You're teaching ${plural(inputs.coursesTaught, "course")} with ` +
        `${plural(inputs.studentsEnrolled, "student")} enrolled. Switching to a ` +
        `student account would leave them without a professor. Remove the ` +
        `students or delete the course first, or ask us to move it to someone else.`,
    };
  }
  return { allowed: true };
}
