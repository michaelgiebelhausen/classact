"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  removeAiKey,
  saveAiKey,
  saveAiModels,
  testAiConnection,
  type AiSettingsView,
} from "@/server/actions/aisettings";

/**
 * BYOK settings: connect an OpenRouter key, watch remaining credits, and
 * choose models per task. ClassAct never bills for course AI — professors
 * bring their own credits and pick exactly what each job runs on.
 */

const TASKS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "taste", label: "Taste-file drafting" },
  { key: "rubric", label: "Rubric emergence" },
  {
    key: "baseline",
    label: "Generic baselines",
    hint: "Cheap model recommended — generic output is the point.",
  },
  { key: "scoring", label: "Submission scoring", hint: "Needs a PDF-capable model." },
  { key: "questions", label: "Deck questions" },
];

export function AiSettingsForm({ settings }: { settings: AiSettingsView }) {
  const router = useRouter();
  const [keyInput, setKeyInput] = useState("");
  const [models, setModels] = useState<Record<string, string>>(settings.models);
  const [busy, setBusy] = useState<string | null>(null);

  const fileModels = settings.modelOptions.filter((m) => m.supportsFiles);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    const result = await fn();
    setBusy(null);
    if (result.ok) {
      toast.success(`${label} — done.`);
      router.refresh();
    } else {
      toast.error(result.error ?? `${label} failed.`);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            OpenRouter account
            {settings.hasKey ? (
              <Badge>Connected · …{settings.keyLast4}</Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
            {settings.keyInfo?.remaining !== null &&
              settings.keyInfo?.remaining !== undefined && (
                <Badge variant="outline">
                  ≈ ${settings.keyInfo.remaining.toFixed(2)} remaining
                </Badge>
              )}
          </CardTitle>
          <CardDescription>
            Course AI (grading, rubrics, question generation) runs on your
            own OpenRouter credits — you control the spend and the models.
            Create a key at openrouter.ai → Keys, then paste it here. We
            encrypt it and never show it again.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-2">
              <Label htmlFor="or-key">
                {settings.hasKey ? "Replace key" : "API key"}
              </Label>
              <Input
                id="or-key"
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-or-v1-…"
                className="w-80 font-mono"
                autoComplete="off"
              />
            </div>
            <Button
              onClick={() =>
                run("Key saved", async () => {
                  const result = await saveAiKey(keyInput);
                  if (result.ok) setKeyInput("");
                  return result;
                })
              }
              disabled={busy !== null || !keyInput.trim()}
            >
              {busy === "Key saved" ? "Validating…" : "Save key"}
            </Button>
            {settings.hasKey && (
              <>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run("Connection test", () => testAiConnection())}
                >
                  {busy === "Connection test" ? "Testing…" : "Test connection"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => run("Key removed", () => removeAiKey())}
                >
                  Remove
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {settings.hasKey && (
        <Card>
          <CardHeader>
            <CardTitle>Models</CardTitle>
            <CardDescription>
              One main model, with optional per-task overrides — tasks cost
              different amounts, so match the model to the job. Prices are
              per million tokens, live from your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <datalist id="all-models">
              {settings.modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.name} — $${m.promptPrice.toFixed(2)}/M in, $${m.completionPrice.toFixed(2)}/M out`}
                </option>
              ))}
            </datalist>
            <datalist id="file-models">
              {fileModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.name} — $${m.promptPrice.toFixed(2)}/M in, $${m.completionPrice.toFixed(2)}/M out`}
                </option>
              ))}
            </datalist>

            <div className="grid gap-2">
              <Label htmlFor="model-default">Main model</Label>
              <Input
                id="model-default"
                list="all-models"
                value={models.default ?? ""}
                onChange={(e) =>
                  setModels((prev) => ({ ...prev, default: e.target.value }))
                }
                placeholder="anthropic/claude-sonnet-5"
                className="max-w-md font-mono"
              />
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Advanced: per-task models
              </summary>
              <div className="mt-3 grid gap-3">
                {TASKS.map((task) => (
                  <div key={task.key} className="grid gap-1">
                    <Label htmlFor={`model-${task.key}`}>{task.label}</Label>
                    <Input
                      id={`model-${task.key}`}
                      list={task.key === "scoring" ? "file-models" : "all-models"}
                      value={models[task.key] ?? ""}
                      onChange={(e) =>
                        setModels((prev) => ({ ...prev, [task.key]: e.target.value }))
                      }
                      placeholder="(main model)"
                      className="max-w-md font-mono"
                    />
                    {task.hint && (
                      <p className="text-xs text-muted-foreground">{task.hint}</p>
                    )}
                  </div>
                ))}
              </div>
            </details>

            <Button
              className="w-fit"
              disabled={busy !== null}
              onClick={() => run("Models saved", () => saveAiModels(models))}
            >
              {busy === "Models saved" ? "Saving…" : "Save models"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
