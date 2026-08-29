import { describe, expect, it } from "vitest";
import {
  looksLikeVtt,
  transcriptToText,
  vttToPlainText,
} from "@/lib/transcripts";

const VTT = `WEBVTT

NOTE
This file was exported by a recorder.

1
00:00:01.000 --> 00:00:04.000
Welcome to lecture five.

2
00:00:04.500 --> 00:00:08.000
<v Professor>Today we cover pricing.</v>

3
00:00:08.000 --> 00:00:11.000
Today we cover pricing.
`;

describe("looksLikeVtt", () => {
  it("recognizes a WEBVTT header", () => {
    expect(looksLikeVtt(VTT)).toBe(true);
  });

  it("recognizes bare SRT-style timestamps without a header", () => {
    const srt = "1\n00:00:01,000 --> 00:00:04,000\nHello there.\n";
    expect(looksLikeVtt(srt)).toBe(true);
  });

  it("leaves plain prose alone", () => {
    expect(looksLikeVtt("Today we covered pricing.\nIt went long.")).toBe(
      false
    );
  });
});

describe("vttToPlainText", () => {
  const text = vttToPlainText(VTT);

  it("drops headers, cue numbers, timestamps, and NOTE blocks", () => {
    expect(text).not.toContain("WEBVTT");
    expect(text).not.toContain("-->");
    expect(text).not.toContain("exported by a recorder");
    expect(text).not.toMatch(/^\d+$/m);
  });

  it("keeps the speech and strips voice tags", () => {
    expect(text).toContain("Welcome to lecture five.");
    expect(text).toContain("Today we cover pricing.");
    expect(text).not.toContain("<v");
  });

  it("collapses the duplicate lines rolling captions produce", () => {
    expect(text.match(/Today we cover pricing\./g)).toHaveLength(1);
  });
});

describe("transcriptToText", () => {
  it("flattens VTT input", () => {
    expect(transcriptToText(VTT)).not.toContain("-->");
  });

  it("passes plain text through, trimmed", () => {
    expect(transcriptToText("  Plain notes.  ")).toBe("Plain notes.");
  });

  it("strips a UTF-8 BOM", () => {
    expect(transcriptToText("﻿Plain notes.")).toBe("Plain notes.");
  });
});
