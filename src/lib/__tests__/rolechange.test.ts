import { describe, expect, test } from "vitest";
import { canLeaveProfessorRole } from "@/lib/rolechange";

describe("canLeaveProfessorRole", () => {
  test("lets someone who teaches nothing switch to student", () => {
    // The whole stuck cohort: tapped 'professor' by mistake, teaches nothing,
    // often already enrolled in the class they cannot reach.
    expect(canLeaveProfessorRole({ coursesTaught: 0, studentsEnrolled: 0 }))
      .toEqual({ allowed: true });
  });

  test("blocks a professor who would strand enrolled students", () => {
    const verdict = canLeaveProfessorRole({
      coursesTaught: 2,
      studentsEnrolled: 47,
    });

    expect(verdict.allowed).toBe(false);
  });

  test("names the courses and students in the refusal so it is actionable", () => {
    const verdict = canLeaveProfessorRole({
      coursesTaught: 2,
      studentsEnrolled: 47,
    });

    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.reason).toMatch(/2/);
    expect(verdict.reason).toMatch(/47/);
  });

  test("allows it when the courses exist but have no students to strand", () => {
    // A course nobody joined is an abandoned draft, not a class in progress.
    // Refusing here would trap the very people this feature exists for.
    expect(canLeaveProfessorRole({ coursesTaught: 1, studentsEnrolled: 0 }))
      .toEqual({ allowed: true });
  });

  test("treats a single course and student with correct grammar", () => {
    const verdict = canLeaveProfessorRole({
      coursesTaught: 1,
      studentsEnrolled: 1,
    });

    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.reason).toContain("1 course");
    expect(verdict.reason).not.toContain("1 courses");
    expect(verdict.reason).toContain("1 student");
    expect(verdict.reason).not.toContain("1 students");
  });
});
