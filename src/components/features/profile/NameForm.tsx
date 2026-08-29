"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMyName } from "@/server/actions/profile";

/**
 * Edit the name (and how to say it) the class sees. Mirrors the first
 * onboarding step, so the two places you set your name look the same.
 */
export function NameForm({
  initialName,
  initialPhonetic,
}: {
  initialName: string;
  initialPhonetic: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phonetic, setPhonetic] = useState(initialPhonetic);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await updateMyName({ fullName: name, namePhonetic: phonetic });
    setSaving(false);
    if (result.ok && result.data) {
      setName(result.data.fullName);
      toast.success("Saved — that's the name your class sees now.");
      // The header on this page reads full_name from the server.
      router.refresh();
    } else if (!result.ok) {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="displayName">Your name</Label>
        <Input
          id="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jordan Rivera"
          className="max-w-md"
          autoComplete="name"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="displayPhonetic">
          How do you say it?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="displayPhonetic"
          value={phonetic}
          onChange={(e) => setPhonetic(e.target.value)}
          placeholder="shiv-AWN muhr-FEE"
          className="max-w-md"
        />
      </div>
      <div>
        <Button onClick={save} disabled={saving} variant="outline">
          {saving ? "Saving…" : "Save name"}
        </Button>
      </div>
    </div>
  );
}
