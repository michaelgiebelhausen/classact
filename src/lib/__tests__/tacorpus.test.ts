import { describe, expect, it } from "vitest";
import {
  assembleCorpus,
  SOURCE_CHAR_CAP,
  taSystemPrompt,
} from "@/lib/tacorpus";

describe("assembleCorpus", () => {
  it("labels every source with ===== markers", () => {
    const { text, dropped } = assembleCorpus([
      { label: "[Syllabus]", text: "Late work loses 10% per day." },
      { label: '[Lecture 1 slides "Intro"]', text: "## Slide 1\nWelcome." },
    ]);
    expect(text).toContain("===== [Syllabus] =====");
    expect(text).toContain('===== [Lecture 1 slides "Intro"] =====');
    expect(text).toContain("Late work loses 10% per day.");
    expect(dropped).toEqual([]);
  });

  it("skips empty sources without dropping them", () => {
    const { text, dropped } = assembleCorpus([
      { label: "[Syllabus]", text: "   " },
      { label: "[Assignment \"HW1\"]", text: "Write a memo." },
    ]);
    expect(text).not.toContain("[Syllabus]");
    expect(dropped).toEqual([]);
  });

  it("caps any single source at SOURCE_CHAR_CAP", () => {
    const { text } = assembleCorpus([
      { label: "[Big]", text: "x".repeat(SOURCE_CHAR_CAP + 1000) },
    ]);
    expect(text).toContain("[…truncated]");
    expect(text.length).toBeLessThan(SOURCE_CHAR_CAP + 200);
  });

  it("drops what doesn't fit the budget and reports it, keeping order priority", () => {
    const big = "y".repeat(500);
    const { text, dropped } = assembleCorpus(
      [
        { label: "[Keep]", text: big },
        { label: "[Drop]", text: big },
      ],
      600
    );
    expect(text).toContain("===== [Keep] =====");
    expect(text).not.toContain("[Drop]");
    expect(dropped).toEqual(["[Drop]"]);
  });
});

describe("taSystemPrompt", () => {
  it("names the course and demands grounding", () => {
    const prompt = taSystemPrompt("MKT 301", []);
    expect(prompt).toContain('"MKT 301"');
    expect(prompt).toContain("ask your professor");
    expect(prompt).not.toContain("Not loaded");
  });

  it("tells the model what fell out of the budget", () => {
    const prompt = taSystemPrompt("MKT 301", ['[Lecture 1 slides "Intro"]']);
    expect(prompt).toContain("Not loaded");
    expect(prompt).toContain('[Lecture 1 slides "Intro"]');
  });
});
