"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMyName } from "@/server/actions/profile";

/**
 * Edit given and family names, each with its own pronunciation. Laid out as two
 * rows — name on the left, "how you say it" on the right — mirroring how the
 * onboarding name step reads.
 */
export function NameForm({
  initialFirst,
  initialLast,
  initialFirstPhonetic,
  initialLastPhonetic,
}: {
  initialFirst: string;
  initialLast: string;
  initialFirstPhonetic: string;
  initialLastPhonetic: string;
}) {
  const router = useRouter();
  const [first, setFirst] = useState(initialFirst);
  const [last, setLast] = useState(initialLast);
  const [firstPhonetic, setFirstPhonetic] = useState(initialFirstPhonetic);
  const [lastPhonetic, setLastPhonetic] = useState(initialLastPhonetic);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await updateMyName({
      firstName: first,
      lastName: last,
      firstNamePhonetic: firstPhonetic,
      lastNamePhonetic: lastPhonetic,
    });
    setSaving(false);
    if (result.ok && result.data) {
      setFirst(result.data.firstName);
      setLast(result.data.lastName);
      setFirstPhonetic(result.data.firstNamePhonetic);
      setLastPhonetic(result.data.lastNamePhonetic);
      toast.success("Saved — that's the name your class sees now.");
      // The header on this page reads the composed name from the server.
      router.refresh();
    } else if (!result.ok) {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
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
          <Label htmlFor="firstPhonetic">
            How you say it{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="firstPhonetic"
            value={firstPhonetic}
            onChange={(e) => setFirstPhonetic(e.target.value)}
            placeholder="JOR-dun"
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="grid gap-2">
          <Label htmlFor="lastPhonetic">
            How you say it{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="lastPhonetic"
            value={lastPhonetic}
            onChange={(e) => setLastPhonetic(e.target.value)}
            placeholder="ree-VAIR-uh"
          />
        </div>
      </div>
      <div>
        <Button onClick={save} disabled={saving} variant="outline">
          {saving ? "Saving…" : "Save name"}
        </Button>
      </div>
    </div>
  );
}
