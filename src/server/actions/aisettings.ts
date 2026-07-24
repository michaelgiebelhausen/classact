"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/aicrypto";
import {
  fetchKeyInfo,
  fetchModels,
  type KeyInfo,
  type ModelOption,
} from "@/server/aicreds";
import type { ActionResult } from "@/server/actions/auth";

/**
 * AI Settings (BYOK) — professors connect their own OpenRouter key and pick
 * models per task. The key is validated live, encrypted at rest, and only
 * its last 4 characters ever return to the client.
 */

const TASK_KEYS = ["default", "taste", "rubric", "baseline", "scoring", "questions"] as const;

async function requireProfessor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, supabase };
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "professor") return { user: null, supabase };
  return { user, supabase };
}

export interface AiSettingsView {
  hasKey: boolean;
  keyLast4: string;
  models: Record<string, string>;
  keyInfo: KeyInfo | null;
  modelOptions: ModelOption[];
}

/** Current settings + live account info (never the key itself). */
export async function getAiSettings(): Promise<AiSettingsView | null> {
  const { user } = await requireProfessor();
  if (!user || !isConfigured.supabaseAdmin) return null;
  const admin = createAdminClient();
  const { data: vault } = await admin
    .from("professor_ai")
    .select("key_ciphertext, key_last4, models")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!vault) {
    return { hasKey: false, keyLast4: "", models: {}, keyInfo: null, modelOptions: [] };
  }
  const models = Object.fromEntries(
    Object.entries((vault.models ?? {}) as Record<string, unknown>).filter(
      ([k, v]) => typeof v === "string" && TASK_KEYS.includes(k as never)
    )
  ) as Record<string, string>;
  let keyInfo: KeyInfo | null = null;
  let modelOptions: ModelOption[] = [];
  if (isConfigured.keyVault) {
    try {
      const apiKey = decryptSecret(vault.key_ciphertext);
      [keyInfo, modelOptions] = await Promise.all([
        fetchKeyInfo(apiKey),
        fetchModels(apiKey),
      ]);
    } catch {
      keyInfo = null;
    }
  }
  return {
    hasKey: true,
    keyLast4: vault.key_last4,
    models,
    keyInfo,
    modelOptions,
  };
}

/** Connect (or replace) the OpenRouter key. Validates before storing. */
export async function saveAiKey(rawKey: string): Promise<ActionResult> {
  const { user } = await requireProfessor();
  if (!user) return { ok: false, error: "Professors only." };
  if (!isConfigured.supabaseAdmin || !isConfigured.keyVault) {
    return {
      ok: false,
      error: "The key vault isn't configured on this server (APP_ENCRYPTION_KEY).",
    };
  }
  const key = rawKey.trim();
  if (!key.startsWith("sk-or-") || key.length < 20) {
    return { ok: false, error: "That doesn't look like an OpenRouter key (sk-or-…)." };
  }
  const info = await fetchKeyInfo(key);
  if (!info.valid) {
    return { ok: false, error: "OpenRouter rejected that key — check it and try again." };
  }
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("professor_ai")
    .select("id, models")
    .eq("profile_id", user.id)
    .maybeSingle();
  const payload = {
    profile_id: user.id,
    key_ciphertext: encryptSecret(key),
    key_last4: key.slice(-4),
    models: existing?.models ?? {},
    updated_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await admin.from("professor_ai").update(payload).eq("id", existing.id)
    : await admin.from("professor_ai").insert(payload);
  if (error) return { ok: false, error: "Couldn't save the key — try again." };
  revalidatePath("/settings/ai");
  return { ok: true };
}

export async function removeAiKey(): Promise<ActionResult> {
  const { user } = await requireProfessor();
  if (!user || !isConfigured.supabaseAdmin) return { ok: false, error: "Professors only." };
  const admin = createAdminClient();
  await admin.from("professor_ai").delete().eq("profile_id", user.id);
  revalidatePath("/settings/ai");
  return { ok: true };
}

/**
 * Save model choices (main + per-task overrides) with a pricing snapshot
 * so cost previews don't need live API calls later.
 */
export async function saveAiModels(
  models: Record<string, string>
): Promise<ActionResult> {
  const { user } = await requireProfessor();
  if (!user || !isConfigured.supabaseAdmin) return { ok: false, error: "Professors only." };
  const admin = createAdminClient();
  const { data: vault } = await admin
    .from("professor_ai")
    .select("id, key_ciphertext")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!vault) return { ok: false, error: "Connect your OpenRouter key first." };

  const cleaned: Record<string, unknown> = {};
  for (const task of TASK_KEYS) {
    const value = models[task];
    if (typeof value === "string" && value.trim() && value.length < 120) {
      cleaned[task] = value.trim();
    }
  }
  // Pricing snapshot for the chosen models (cost previews).
  try {
    const apiKey = decryptSecret(vault.key_ciphertext);
    const options = await fetchModels(apiKey);
    const chosen = new Set(Object.values(cleaned) as string[]);
    const pricing: Record<string, { prompt: number; completion: number }> = {};
    for (const option of options) {
      if (chosen.has(option.id)) {
        pricing[option.id] = {
          prompt: option.promptPrice,
          completion: option.completionPrice,
        };
      }
    }
    cleaned.pricing = pricing;
  } catch {
    // snapshot is best-effort
  }

  const { error } = await admin
    .from("professor_ai")
    .update({ models: cleaned, updated_at: new Date().toISOString() })
    .eq("id", vault.id);
  if (error) return { ok: false, error: "Couldn't save model choices." };
  revalidatePath("/settings/ai");
  return { ok: true };
}

/** Short ping with the stored key + main model: "is this wired?" */
export async function testAiConnection(): Promise<ActionResult<{ model: string }>> {
  const { user } = await requireProfessor();
  if (!user || !isConfigured.supabaseAdmin || !isConfigured.keyVault) {
    return { ok: false, error: "Professors only." };
  }
  const admin = createAdminClient();
  const { data: vault } = await admin
    .from("professor_ai")
    .select("key_ciphertext, models")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!vault) return { ok: false, error: "Connect your OpenRouter key first." };
  try {
    const apiKey = decryptSecret(vault.key_ciphertext);
    const models = (vault.models ?? {}) as Record<string, string>;
    const model = models.default ?? "openrouter/auto";
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        max_tokens: 4,
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `OpenRouter said ${response.status} — check the key and model ("${model}").`,
      };
    }
    return { ok: true, data: { model } };
  } catch {
    return { ok: false, error: "Couldn't reach OpenRouter — try again." };
  }
}
