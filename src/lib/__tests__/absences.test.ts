import { describe, expect, it } from "vitest";
import {
  ABSENCE_CATEGORY_KEYS,
  DEFAULT_ATTENDANCE_POLICY,
  advanceHours,
  finalVerdict,
  flagPolicyConflicts,
  noticeLabel,
  parseAttendancePolicy,
  policyOverride,
  validateAssessment,
  type AbsenceAssessment,
} from "@/lib/absences";

describe("parseAttendancePolicy", () => {
  it("returns the defaults for an empty or missing policy", () => {
    expect(parseAttendancePolicy({})).toEqual(DEFAULT_ATTENDANCE_POLICY);
    expect(parseAttendancePolicy(null)).toEqual(DEFAULT_ATTENDANCE_POLICY);
    expect(parseAttendancePolicy("junk")).toEqual(DEFAULT_ATTENDANCE_POLICY);
  });

  it("keeps what the professor set and fills the rest", () => {
    const p = parseAttendancePolicy({
      text: "Show up.",
      excusedCategories: ["athletics", "bogus", 3],
      advanceNoticeHours: "24",
    });
    expect(p.text).toBe("Show up.");
    expect(p.excusedCategories).toEqual(["athletics"]);
    expect(p.advanceNoticeHours).toBe(24);
    expect(p.freeUnexcused).toBe(DEFAULT_ATTENDANCE_POLICY.freeUnexcused);
  });

  it("clamps hostile numbers and trims oversize text", () => {
    const p = parseAttendancePolicy({
      advanceNoticeHours: Infinity,
      freeUnexcused: -5,
      text: "x".repeat(10_000),
    });
    expect(p.advanceNoticeHours).toBe(DEFAULT_ATTENDANCE_POLICY.advanceNoticeHours);
    expect(p.freeUnexcused).toBe(0);
    expect(p.text.length).toBe(4000);
  });

  it("an explicitly empty excused list stays empty (strict professor)", () => {
    expect(parseAttendancePolicy({ excusedCategories: [] }).excusedCategories).toEqual([]);
  });
});

describe("noticeLabel / advanceHours", () => {
  it("describes notice in the unit a professor would use", () => {
    expect(noticeLabel(72)).toBe("3 days ahead");
    expect(noticeLabel(5)).toBe("5 h ahead");
    expect(noticeLabel(0.5)).toBe("30 min ahead");
    expect(noticeLabel(-0.7)).toBe("42 min after class began");
    expect(noticeLabel(-30)).toBe("30 h after class began");
    expect(noticeLabel(null)).toBe("no schedule to measure");
  });

  it("measures from submission to class start, to a tenth of an hour", () => {
    const start = new Date("2026-08-24T13:30:00Z");
    expect(advanceHours(new Date("2026-08-22T13:30:00Z"), start)).toBe(48);
    expect(advanceHours(new Date("2026-08-24T14:00:00Z"), start)).toBe(-0.5);
    expect(advanceHours(new Date(), null)).toBeNull();
  });
});

describe("validateAssessment", () => {
  const good = {
    verdict: "excused",
    legitimacy: 82,
    summary: "Away game at Georgia Tech; travel letter attached",
    reason: "Team travel is excused under your professor's policy.",
    docKind: "team travel letter",
    docAuthenticity: 90,
    flags: ["late_notice", "nonsense"],
  };

  it("accepts a well-formed reply and drops unknown flags", () => {
    const a = validateAssessment(good, true);
    expect(a).not.toBeNull();
    expect(a!.verdict).toBe("excused");
    expect(a!.flags).toEqual(["late_notice"]);
    expect(a!.docKind).toBe("team travel letter");
    expect(a!.docAuthenticity).toBe(90);
  });

  it("refuses to invent a document assessment when none was sent", () => {
    const a = validateAssessment(good, false);
    expect(a!.docKind).toBeNull();
    expect(a!.docAuthenticity).toBeNull();
  });

  it("clamps scores and caps strings", () => {
    const a = validateAssessment(
      { ...good, legitimacy: 900, summary: "s".repeat(500), reason: "r".repeat(1000) },
      true
    );
    expect(a!.legitimacy).toBe(100);
    expect(a!.summary.length).toBe(140);
    expect(a!.reason.length).toBe(400);
  });

  it("rejects a reply with no usable verdict or no text", () => {
    expect(validateAssessment({ ...good, verdict: "maybe" }, true)).toBeNull();
    expect(validateAssessment({ ...good, summary: "" }, true)).toBeNull();
    expect(validateAssessment(null, true)).toBeNull();
    expect(validateAssessment("excused", true)).toBeNull();
  });
});

describe("policyOverride / finalVerdict", () => {
  it("unexcuses a category that needs documentation when none is attached", () => {
    const policy = { ...DEFAULT_ATTENDANCE_POLICY, docsRequiredFor: ["illness" as const] };
    const o = policyOverride(policy, { category: "illness", hasDocumentation: false });
    expect(o?.verdict).toBe("unexcused");
    expect(policyOverride(policy, { category: "illness", hasDocumentation: true })).toBeNull();
    expect(policyOverride(policy, { category: "athletics", hasDocumentation: false })).toBeNull();
  });

  it("the professor's ruling wins over the AI's", () => {
    expect(finalVerdict({ ai_verdict: "unexcused", professor_verdict: "excused" })).toBe("excused");
    expect(finalVerdict({ ai_verdict: "unexcused", professor_verdict: null })).toBe("unexcused");
  });

  it("every category key is a valid DB enum value", () => {
    expect(ABSENCE_CATEGORY_KEYS).toEqual([
      "athletics",
      "interview",
      "university_event",
      "religious",
      "family",
      "illness",
      "bereavement",
      "other",
    ]);
  });
});

describe("flagPolicyConflicts", () => {
  const base: AbsenceAssessment = {
    verdict: "excused",
    legitimacy: 80,
    summary: "s",
    reason: "r",
    docKind: null,
    docAuthenticity: null,
    flags: [],
  };
  // Athletics excused, 48h notice expected.
  const policy = {
    ...DEFAULT_ATTENDANCE_POLICY,
    excusedCategories: ["athletics" as const],
    advanceNoticeHours: 48,
  };

  it("flags an excused verdict for a category the professor never excuses", () => {
    // This is what a successful prompt injection would look like.
    const flags = flagPolicyConflicts(base, policy, {
      category: "other",
      advanceHours: 100,
    });
    expect(flags).toContain("contradicts_policy");
  });

  it("leaves an excused verdict alone when the category is excusable", () => {
    const flags = flagPolicyConflicts(base, policy, {
      category: "athletics",
      advanceHours: 100,
    });
    expect(flags).toEqual([]);
  });

  it("flags late notice on planned absences only", () => {
    expect(
      flagPolicyConflicts(base, policy, { category: "athletics", advanceHours: 2 })
    ).toContain("late_notice");
    // Illness can't be planned, so short notice is normal.
    expect(
      flagPolicyConflicts(base, policy, { category: "illness", advanceHours: 2 })
    ).not.toContain("late_notice");
    // Bereavement likewise.
    expect(
      flagPolicyConflicts(base, policy, { category: "bereavement", advanceHours: -3 })
    ).not.toContain("late_notice");
  });

  it("keeps the model's own flags and never duplicates", () => {
    const flags = flagPolicyConflicts(
      { ...base, flags: ["late_notice", "vague"] },
      policy,
      { category: "athletics", advanceHours: 1 }
    );
    expect(flags.filter((f) => f === "late_notice")).toHaveLength(1);
    expect(flags).toContain("vague");
  });

  it("doesn't guess at notice when the course has no schedule", () => {
    expect(
      flagPolicyConflicts(base, policy, { category: "athletics", advanceHours: null })
    ).not.toContain("late_notice");
  });

  it("an unexcused verdict never picks up contradicts_policy", () => {
    const flags = flagPolicyConflicts(
      { ...base, verdict: "unexcused" },
      policy,
      { category: "other", advanceHours: 100 }
    );
    expect(flags).not.toContain("contradicts_policy");
  });
});
