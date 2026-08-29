"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMyName } from "@/server/actions/profile";

/**
 * Edit given and family names separately, plus how to say them. Mirrors the
 * first onboarding step, so the two places you set your name look the same.
 */
export function NameForm({
  initialFirst,
  initialLast,
  initialPhonetic,
}: {
  initialFirst: string;
  initialLast: string;
  initialPhonetic: string;
}) {
  const router = useRouter();
  const [first, setFirst] = useState(initialFirst);
  const [last, setLast] = useState(initialLast);
  const [phonetic, setPhonetic] = useState(initialPhonetic);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await updateMyName({
      firstName: first,
      lastName: last,
      namePhonetic: phonetic,
    });
    setSaving(false);
    if (result.ok && result.data) {
      setFirst(result.data.firstName);
      setLast(result.data.lastName);
      toast.success("Saved — that's the name your class sees now.");
      // The header on this page reads the composed name from the server.
      router.refresh();
    } else if (!result.ok) {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            placeholder="Jordan"
            autoComplete="given-name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            value={last}
            onChange={(e) => setLast(e.target.value)}
            placeholder="Rivera"
            autoComplete="family-name"
          />
        </div>
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
