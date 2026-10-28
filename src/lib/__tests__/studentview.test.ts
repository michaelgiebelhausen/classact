import { describe, expect, it } from "vitest";
import { studentViewPath } from "@/lib/studentview";

describe("student view route mapping", () => {
  it("preserves the section and maps the exact assignment in both directions", () => {
    expect(studentViewPath('/course/live/checkin','live','practice')).toBe('/course/practice/checkin');
    expect(studentViewPath('/course/live/assignments/a?copy=other#private','live','practice',{a:'b'})).toBe('/course/practice/assignments/b');
    expect(studentViewPath('/course/practice/assignments/b','practice','live',{b:'a'})).toBe('/course/live/assignments/a');
  });
  it("does not carry instructor-only routes, other courses or unmapped draft projects", () => {
    expect(studentViewPath('/course/live/setup','live','practice')).toBe('/course/practice');
    expect(studentViewPath('/course/live/projects/draft','live','practice')).toBe('/course/practice/projects');
    expect(studentViewPath('/course/live-other/checkin','live','practice')).toBe('/course/practice');
    expect(studentViewPath('https://evil.example/course/live','live','practice')).toBe('/course/practice');
    expect(studentViewPath('/course/live/assignments/a/private','live','practice',{a:'b'})).toBe('/course/practice/assignments');
  });
});
