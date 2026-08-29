import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/aicrypto";
import { env, isConfigured } from "@/lib/env";

/**
 * BYOK credential resolution (docs/byok-billing-plan.md): course-scoped AI
 * runs on the course owner's own OpenRouter key + model choices, with two
 * fallbacks to the system env key: founder accounts (all tasks), and
 * platform-subsidized tasks (peer instruction) for everyone — the data those
 * features generate is the platform's return on that spend. Grading tasks
 * are never platform-paid for non-founders (Mike: "I really don't want to
 * pay for AI credits to help other people grade their papers"). Returns
 * null when no working credentials exist — the caller pauses
 * (awaiting_key), never bills the platform.
 */

export type AiTask =
  | "taste"
  | "rubric"
  | "baseline"
  | "scoring"
  | "questions"
  | "absence"
  | "ta"
  | "extract";

/**
 * Tasks the platform covers on the system key when the professor has no key.
 * The rule: non-grading AI is on the house; grading stays BYOK. Absence
 * assessment is administrative (a few hundred tokens) and belongs here.
 * Ask-the-TA ("ta") and material indexing ("extract") stay OFF this list on
 * purpose — open-ended student chat over big corpora is exactly the spend
 * Mike doesn't want to absorb; a keyless course simply has no TA.
 */
const PLATFORM_SUBSIDIZED: readonly AiTask[] = ["questions", "absence"];

export interface CourseAiCreds {
  apiKey: string;
  model: string;
  source: "professor" | "founder" | "platform";
}

interface StoredModels {
  default?: string;
  taste?: string;
  rubric?: string;
  baseline?: string;
  scoring?: string;
  questions?: string;
  absence?: string;
  ta?: string;
  extract?: string;
  /** Pricing snapshot captured at settings-save time: modelId → $/Mtok. */
  pricing?: Record<string, { prompt: number; completion: number }>;
}

export function modelForTask(models: StoredModels, task: AiTask): string {
  return models[task] ?? models.default ?? env.openrouterModel;
}

/** Resolve the key + model for one AI task in one course. Null = pause. */
export async function resolveCourseAi(
  courseId: string,
  task: AiTask
): Promise<CourseAiCreds | null> {
  if (!isConfigured.supabaseAdmin) return null;
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("professor_id")
    .eq("id", courseId)
    .single();
  if (!course) return null;

  const [{ data: vault }, { data: profile }] = await Promise.all([
    admin
      .from("professor_ai")
      .select("key_ciphertext, models")
      .eq("profile_id", course.professor_id)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("founder")
      .eq("id", course.professor_id)
      .maybeSingle(),
  ]);

  if (vault && isConfigured.keyVault) {
    try {
      const models = (vault.models ?? {}) as StoredModels;
      return {
        apiKey: decryptSecret(vault.key_ciphertext),
        model: modelForTask(models, task),
        source: "professor",
      };
    } catch (e) {
      console.error("[aicreds] key decrypt failed (key rotated?):", e);
      // fall through — treat as missing
    }
  }
  if (env.openrouterApiKey) {
    if (profile?.founder) {
      return {
        apiKey: env.openrouterApiKey,
        model: env.openrouterModel,
        source: "founder",
      };
    }
    if (PLATFORM_SUBSIDIZED.includes(task)) {
      return {
        apiKey: env.openrouterApiKey,
        model: env.openrouterModel,
        source: "platform",
      };
    }
  }
  return null;
}

/** Pricing snapshot for the course's scoring model (cost previews). */
export async function scoringPricing(
  courseId: string
): Promise<{ model: string; prompt: number; completion: number } | null> {
  if (!isConfigured.supabaseAdmin) return null;
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("professor_id")
    .eq("id", courseId)
    .single();
  if (!course) return null;
  const { data: vault } = await admin
    .from("professor_ai")
    .select("models")
    .eq("profile_id", course.professor_id)
    .maybeSingle();
  if (!vault) return null;
  const models = (vault.models ?? {}) as StoredModels;
  const model = modelForTask(models, "scoring");
  const pricing = models.pricing?.[model];
  if (!pricing) return null;
  return { model, ...pricing };
}

// ---------------------------------------------------------------------------
// OpenRouter account introspection (used by settings + preflight)
// ---------------------------------------------------------------------------

export interface KeyInfo {
  valid: boolean;
  /** Dollars spent / limit (null = unlimited or unknown). */
  usage: number | null;
  limit: number | null;
  remaining: number | null;
}

export async function fetchKeyInfo(apiKey: string): Promise<KeyInfo> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { valid: false, usage: null, limit: null, remaining: null };
    }
    const payload = (await response.json()) as {
      data?: { usage?: number; limit?: number | null };
    };
    const usage = typeof payload.data?.usage === "number" ? payload.data.usage : null;
    const limit = typeof payload.data?.limit === "number" ? payload.data.limit : null;
    return {
      valid: true,
      usage,
      limit,
      remaining: limit !== null && usage !== null ? Math.max(0, limit - usage) : null,
    };
  } catch {
    return { valid: false, usage: null, limit: null, remaining: null };
  }
}

export interface ModelOption {
  id: string;
  name: string;
  /** $ per million tokens. */
  promptPrice: number;
  completionPrice: number;
  supportsFiles: boolean;
}

/** The professor-facing model list, via their own key. */
export async function fetchModels(apiKey: string): Promise<ModelOption[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { input_modalities?: string[] };
      }>;
    };
    return (payload.data ?? [])
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        promptPrice: Number(m.pricing?.prompt ?? 0) * 1_000_000,
        completionPrice: Number(m.pricing?.completion ?? 0) * 1_000_000,
        supportsFiles: (m.architecture?.input_modalities ?? []).includes("file"),
      }))
      .filter((m) => Number.isFinite(m.promptPrice))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
