import "server-only";
import { env } from "@/lib/env";
import { buildLayout, validateLayout, type PresetParams } from "@/lib/roomlayout";

/**
 * AI room drafting via OpenRouter (same account/model as question
 * generation): a photo of the classroom — or a registrar seating chart —
 * comes in, preset knobs come out. The model never emits raw geometry;
 * it picks one of the designer's presets and estimates its parameters, so
 * every draft lands in the same editable controls the professor already
 * has, and passes through the same validation as a hand-built room.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DRAFT_TIMEOUT_MS = 120_000;

export interface RoomDraft {
  params: PresetParams;
  notes: string;
}

type DraftResult = { ok: true; draft: RoomDraft } | { ok: false; error: string };

const SYSTEM_PROMPT = [
  "You are helping a college professor map their physical classroom into a seat-map app.",
  "You will receive one image: a photo of the room (often taken from the front or back), or a seating chart / floor-plan diagram.",
  "Pick the ONE room preset that best matches, and estimate its parameters by counting what you can see and extrapolating what you can't.",
  "",
  "Presets and their JSON shapes (all numbers are integers unless noted):",
  '1. Straight rows, flat floor: {"type":"classroom","rows":N,"cols":N,"aisleCount":N} — rows 1-40, cols (seats per row) 1-40, aisleCount 0-3.',
  '2. One shared table: {"type":"seminar","shape":"oval"|"rect"|"ushape","seats":N} — seats 2-26.',
  '3. Curved rows wrapping the front (case-study rooms): {"type":"horseshoe","rows":N,"frontSeats":N} — rows 1-6, frontSeats 4-30.',
  '4. Tiered lecture hall / auditorium: {"type":"auditorium","rows":N,"frontSeats":N,"backSeats":N,"aisleCount":N,"curve":F,"balconyRows":N} — rows 2-40, frontSeats/backSeats 2-40 (front rows are usually shorter than back rows), aisleCount 0-4, curve 0.0-1.0 (0 = straight rows, ~0.4 = gently fanned, ~0.8 = strongly wrapped), balconyRows 0-5 (almost always 0).',
  '5. Separate small-group tables: {"type":"pods","tables":N,"seatsPerTable":N} — tables 1-20, seatsPerTable 2-10.',
  "",
  "Estimation guidance:",
  "- Count seats in one clearly visible row and count rows; don't try to count every seat.",
  "- Aisles are the walkways cutting vertically through seat blocks — count them.",
  "- If only part of the room is visible, extrapolate symmetrically and say so in notes.",
  "- A seating chart/diagram is authoritative: read its counts directly.",
  "- When genuinely torn between two presets, choose the one whose check-in map will confuse students least, and say what you rejected in notes.",
  "",
  'Reply with ONLY a JSON object, no markdown fences: {"preset": <one preset object>, "notes": string}',
  "notes: 1-3 sentences for the professor — what you counted, what you assumed, what they should double-check.",
].join("\n");

/** Tolerate models that wrap JSON in markdown fences despite instructions. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function toInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? Math.round(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Coerce the model's preset into safe knob ranges; null if unusable. */
function coercePreset(raw: unknown): PresetParams | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  switch (p.type) {
    case "classroom":
      return {
        type: "classroom",
        rows: toInt(p.rows, 1, 40, 6),
        cols: toInt(p.cols, 1, 40, 8),
        aisleCount: toInt(p.aisleCount, 0, 3, 1),
      };
    case "seminar":
      return {
        type: "seminar",
        shape: p.shape === "rect" || p.shape === "ushape" ? p.shape : "oval",
        seats: toInt(p.seats, 2, 26, 12),
      };
    case "horseshoe":
      return {
        type: "horseshoe",
        rows: toInt(p.rows, 1, 6, 3),
        frontSeats: toInt(p.frontSeats, 4, 30, 8),
      };
    case "auditorium": {
      const front = toInt(p.frontSeats, 2, 40, 10);
      return {
        type: "auditorium",
        rows: toInt(p.rows, 2, 40, 10),
        frontSeats: front,
        // Auditorium rows widen toward the back; never let back < front.
        backSeats: Math.max(front, toInt(p.backSeats, 2, 40, 16)),
        aisleCount: toInt(p.aisleCount, 0, 4, 2),
        curve:
          typeof p.curve === "number" && Number.isFinite(p.curve)
            ? Math.min(1, Math.max(0, p.curve))
            : 0.4,
        balconyRows: toInt(p.balconyRows, 0, 5, 0),
      };
    }
    case "pods":
      return {
        type: "pods",
        tables: toInt(p.tables, 1, 20, 6),
        seatsPerTable: toInt(p.seatsPerTable, 2, 10, 5),
      };
    default:
      return null;
  }
}

export async function draftRoomFromImage(input: {
  imageBase64: string;
  mimeType: string;
}): Promise<DraftResult> {
  const apiKey = env.openrouterApiKey;
  if (!apiKey) {
    console.error("[roomvision] OPENROUTER_API_KEY is not set in this server process.");
    return {
      ok: false,
      error:
        "AI drafting isn't configured yet — add OPENROUTER_API_KEY to .env.local and restart the app.",
    };
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.siteUrl,
        "X-Title": "ClassAct",
      },
      body: JSON.stringify({
        model: env.openrouterModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Here is my classroom. Draft the seat map preset.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${input.mimeType};base64,${input.imageBase64}`,
                },
              },
            ],
          },
        ],
        temperature: 0.2,
      }),
    });
  } catch {
    return {
      ok: false,
      error: "Couldn't reach OpenRouter — check your connection and try again.",
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[roomvision] OpenRouter ${response.status}: ${detail.slice(0, 500)}`);
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "OpenRouter rejected the API key — check OPENROUTER_API_KEY." };
    }
    if (response.status === 400 || response.status === 404) {
      return {
        ok: false,
        error: `OpenRouter didn't accept the request (model "${env.openrouterModel}"). It may not support images — set OPENROUTER_MODEL to a vision-capable model.`,
      };
    }
    return { ok: false, error: `OpenRouter error (${response.status}) — try again in a moment.` };
  }

  let text: string;
  try {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    text = payload.choices?.[0]?.message?.content ?? "";
  } catch {
    console.error("[roomvision] OpenRouter response body was not JSON.");
    return { ok: false, error: "OpenRouter returned an unreadable response." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.error(`[roomvision] Model reply wasn't valid JSON: ${text.slice(0, 300)}`);
    return { ok: false, error: "The AI couldn't read this image — try a clearer photo." };
  }

  const preset = coercePreset((parsed as { preset?: unknown }).preset);
  if (!preset) {
    console.error(`[roomvision] Model JSON had no usable preset: ${text.slice(0, 300)}`);
    return {
      ok: false,
      error: "The AI couldn't map this room — try a clearer photo, or build it from a preset.",
    };
  }

  // Final gate: the drafted knobs must build a valid room.
  const invalid = validateLayout(buildLayout(preset));
  if (invalid) {
    console.error(`[roomvision] Drafted preset failed validation: ${invalid}`);
    return {
      ok: false,
      error: "The AI's draft wasn't usable — try again or build it from a preset.",
    };
  }

  const rawNotes = (parsed as { notes?: unknown }).notes;
  return {
    ok: true,
    draft: {
      params: preset,
      notes: typeof rawNotes === "string" ? rawNotes.slice(0, 600) : "",
    },
  };
}
