"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveLinkedInUrl } from "@/server/actions/profile";

/**
 * The handle that lets a classroom connection outlast the term. Accepts a
 * bare handle or any linkedin.com/in/… paste; the server canonicalizes.
 */
export function LinkedInForm({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await saveLinkedInUrl(value);
    setSaving(false);
    if (result.ok && result.data) {
      setSaved(result.data.url);
      setValue(result.data.url ?? "");
      toast.success(
        result.data.url ? "LinkedIn saved." : "LinkedIn link removed."
      );
    } else if (!result.ok) {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your-handle  or  linkedin.com/in/your-handle"
          className="max-w-md"
          inputMode="url"
          autoComplete="off"
          aria-label="LinkedIn profile"
        />
        <Button onClick={save} disabled={saving} variant="outline">
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {saved ? (
        <a
          href={saved}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ExternalLink className="size-4" /> {saved.replace("https://www.", "")}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          Leave it blank to keep it to yourself — it only ever shows to people
          in your courses.
        </p>
      )}
    </div>
  );
}
