/**
 * Lecture transcripts arrive as whatever a recorder exports — plain text,
 * Markdown, or WebVTT captions (Zoom, Panopto, YouTube). The stored
 * transcript_text feeds the Ask-the-TA corpus, where cue numbers and
 * timestamps are pure noise, so VTT is flattened to readable prose here.
 */

const VTT_TIMESTAMP =
  /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}.*$/

/** True when the content looks like a WebVTT / SRT caption file. */
export function looksLikeVtt(content: string): boolean {
  const head = content.slice(0, 500)
  if (head.trimStart().startsWith("WEBVTT")) return true
  return head.split(/\r?\n/).some((line) => VTT_TIMESTAMP.test(line))
}

/**
 * Strip VTT/SRT scaffolding down to the spoken text: drops the WEBVTT
 * header, NOTE/STYLE blocks, cue numbers, and timestamp lines; removes
 * inline voice/formatting tags; collapses the consecutive duplicate lines
 * that rolling captions produce.
 */
export function vttToPlainText(content: string): string {
  const lines = content.replace(/^﻿/, "").split(/\r?\n/)
  const out: string[] = []
  let inNoteBlock = false
  for (const raw of lines) {
    const line = raw.trim()
    if (inNoteBlock) {
      if (line === "") inNoteBlock = false
      continue
    }
    if (line === "" || line === "WEBVTT" || line.startsWith("WEBVTT ")) continue
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
      inNoteBlock = true
      continue
    }
    if (VTT_TIMESTAMP.test(line)) continue
    if (/^\d+$/.test(line)) continue // SRT-style cue counter
    const text = line.replace(/<[^>]*>/g, "").trim()
    if (!text) continue
    if (out.length > 0 && out[out.length - 1] === text) continue
    out.push(text)
  }
  return out.join("\n")
}

/** Normalize any accepted transcript upload to the text we store. */
export function transcriptToText(content: string): string {
  const text = looksLikeVtt(content) ? vttToPlainText(content) : content
  return text.replace(/^﻿/, "").trim()
}
