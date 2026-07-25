"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveProfileAnswers } from "@/server/actions/profile";
import type { IcebreakerField } from "@/lib/icebreakers";

/**
 * The professor's own icebreaker answers — the same questions they ask
 * their classes, so their flash card has a back side like everyone else's.
 */

interface Props {
  fields: IcebreakerField[];
  initial: Record<string, string>;
}

export function AboutMeForm({ fields, initial }: Props) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await saveProfileAnswers(values);
    setSaving(false);
    if (result.ok) {
      toast.success("Saved — your students will see this in the name games.");
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      {fields.map((field) => (
        <div key={field.key} className="grid gap-1.5">
          <Label htmlFor={`about-${field.key}`}>{field.label}</Label>
          <p className="text-xs text-muted-foreground">{field.prompt}</p>
          {field.multiline ? (
            <textarea
              id={`about-${field.key}`}
              value={values[field.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field.key]: e.target.value }))
              }
              placeholder={field.placeholder}
              rows={2}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          ) : (
            <Input
              id={`about-${field.key}`}
              value={values[field.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field.key]: e.target.value }))
              }
              placeholder={field.placeholder}
            />
          )}
        </div>
      ))}
      <Button onClick={save} disabled={saving} className="w-fit">
        {saving ? "Saving…" : "Save answers"}
      </Button>
    </div>
  );
}
