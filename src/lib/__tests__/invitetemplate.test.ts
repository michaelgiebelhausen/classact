import { describe, expect, it } from "vitest";
import {
  DEFAULT_INVITE_MESSAGE,
  DEFAULT_INVITE_SUBJECT,
  INVITE_MESSAGE_MAX,
  INVITE_SUBJECT_MAX,
  renderInvite,
  validateInvite,
  type InviteVars,
} from "@/lib/invitetemplate";

const VARS: InviteVars = {
  name: "Jordan Rivera",
  course: "Marketing 301",
  link: "https://classact.college/join/ABC123",
  code: "ABC123",
};

describe("renderInvite", () => {
  it("substitutes every token", () => {
    const out = renderInvite("{name} / {course} / {link} / {code}", VARS);
    expect(out).toBe(
      "Jordan Rivera / Marketing 301 / https://classact.college/join/ABC123 / ABC123"
    );
  });

  it("replaces repeated tokens", () => {
    expect(renderInvite("{code} {code} {code}", VARS)).toBe("ABC123 ABC123 ABC123");
  });

  it("leaves unknown tokens alone rather than blanking them", () => {
    expect(renderInvite("Hi {nickname}, see {link}", VARS)).toBe(
      "Hi {nickname}, see https://classact.college/join/ABC123"
    );
  });

  it("does not re-expand a token that appears inside a value", () => {
    // A course genuinely named "{code} Lab" must survive as typed — the whole
    // reason substitution happens in one pass.
    const out = renderInvite("Welcome to {course}", { ...VARS, course: "{code} Lab" });
    expect(out).toBe("Welcome to {code} Lab");
  });

  it("renders the shipped default with no tokens left behind", () => {
    const out = renderInvite(DEFAULT_INVITE_MESSAGE, VARS);
    expect(out).toContain("Hi Jordan Rivera,");
    expect(out).toContain("https://classact.college/join/ABC123");
    expect(out).not.toMatch(/\{(name|course|link|code)\}/);
  });

  it("renders the default subject", () => {
    expect(renderInvite(DEFAULT_INVITE_SUBJECT, VARS)).toBe(
      "Marketing 301 is using ClassAct — activate your seat"
    );
  });
});

describe("validateInvite", () => {
  const good = { subject: DEFAULT_INVITE_SUBJECT, message: DEFAULT_INVITE_MESSAGE };

  it("accepts the shipped default", () => {
    expect(validateInvite(good)).toMatchObject({ ok: true });
  });

  it("trims what it returns", () => {
    const result = validateInvite({
      subject: "  Come join  ",
      message: "  Join at {link}  ",
    });
    expect(result).toEqual({ ok: true, subject: "Come join", message: "Join at {link}" });
  });

  it("rejects an empty subject", () => {
    expect(validateInvite({ ...good, subject: "   " })).toMatchObject({ ok: false });
  });

  it("rejects an empty message rather than silently sending the default", () => {
    expect(validateInvite({ ...good, message: "" })).toMatchObject({ ok: false });
  });

  it("rejects a message with no join link — it cannot do its job", () => {
    const result = validateInvite({ ...good, message: "Class starts Monday. See you." });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("{link}");
  });

  it("rejects over-long input", () => {
    expect(
      validateInvite({ ...good, subject: "x".repeat(INVITE_SUBJECT_MAX + 1) })
    ).toMatchObject({ ok: false });
    expect(
      validateInvite({ ...good, message: `{link} ${"x".repeat(INVITE_MESSAGE_MAX)}` })
    ).toMatchObject({ ok: false });
  });
});
