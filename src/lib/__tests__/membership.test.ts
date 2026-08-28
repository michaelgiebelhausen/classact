import { describe, expect, test } from "vitest";
import {
  attends,
  needsChooser,
  needsOnboarding,
  teaches,
  type Membership,
} from "@/lib/membership";

const nobody: Membership = { coursesTaught: 0, classesJoined: 0 };

describe("teaches / attends", () => {
  test("owning a course makes you a professor, of that course", () => {
    expect(teaches({ coursesTaught: 1, classesJoined: 0 })).toBe(true);
  });

  test("holding an enrollment makes you a student, of that class", () => {
    expect(attends({ coursesTaught: 0, classesJoined: 1 })).toBe(true);
  });

  test("the same person can be both — this is the case the old flag couldn't hold", () => {
    // The professor in the AI Tools class: runs his own course, sits in Mike's.
    // Under `profiles.role` one of those two facts had to be a lie.
    const both: Membership = { coursesTaught: 1, classesJoined: 1 };
    expect(teaches(both)).toBe(true);
    expect(attends(both)).toBe(true);
  });
});

describe("needsChooser", () => {
  test("a fresh account is asked which door it came for", () => {
    expect(needsChooser(nobody)).toBe(true);
  });

  test("once you own a course there is a dashboard to draw instead", () => {
    expect(needsChooser({ coursesTaught: 1, classesJoined: 0 })).toBe(false);
  });

  test("once you've joined a class there is a dashboard to draw instead", () => {
    expect(needsChooser({ coursesTaught: 0, classesJoined: 1 })).toBe(false);
  });
});

describe("needsOnboarding", () => {
  test("owed once you're in somebody's class", () => {
    expect(needsOnboarding({ coursesTaught: 0, classesJoined: 1 }, false)).toBe(
      true
    );
  });

  test("not owed twice", () => {
    expect(needsOnboarding({ coursesTaught: 0, classesJoined: 1 }, true)).toBe(
      false
    );
  });

  test("a professor building their first course is never marched through it", () => {
    // The old gate read `role === 'student'`, so this depended on a flag being
    // right. It no longer depends on anything anyone typed.
    expect(needsOnboarding({ coursesTaught: 1, classesJoined: 0 }, false)).toBe(
      false
    );
  });

  test("but a professor who joins a colleague's class is onboarded for it", () => {
    expect(needsOnboarding({ coursesTaught: 3, classesJoined: 1 }, false)).toBe(
      true
    );
  });

  test("a brand-new account isn't held at a gate it can't satisfy", () => {
    // Nothing to onboard *into* — sending them to /onboarding here is the
    // redirect loop the chooser exists to avoid.
    expect(needsOnboarding(nobody, false)).toBe(false);
  });
});
