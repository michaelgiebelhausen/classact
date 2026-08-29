"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateTaEnabled } from "@/server/actions/courses";

interface Props {
  courseId: string;
  enabled: boolean;
  /** No key = the toggle is moot; it renders disabled with a hint. */
  hasKey: boolean;
}

/**
 * Professor-only: the TA's master switch. Off by default (0041) so a key
 * connected for grading never silently starts paying for student chat —
 * turning this on is the deliberate opt-in.
 */
export function TaTogglePanel({ courseId, enabled, hasKey }: Props) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setOn(next);
    setSaving(true);
    const result = await updateTaEnabled(courseId, next);
    setSaving(false);
    if (!result.ok) {
      setOn(!next);
      toast.error(result.error);
      return;
    }
    toast.success(
      next
        ? "The TA is live — students can ask it questions now."
        : "The TA is off. Grading and question generation aren't affected."
    );
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">TA availability</CardTitle>
        <CardDescription>
          Questions run on your OpenRouter key (capped at 30/day per person,
          400/day per course). Your other AI features — grading, question
          generation — are separate and unaffected by this switch.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            disabled={saving || !hasKey}
            onChange={(e) => void toggle(e.target.checked)}
          />
          Students can ask the TA
        </label>
        {!hasKey && (
          <p className="mt-2 text-xs text-muted-foreground">
            Connect an OpenRouter key in AI Settings first — the switch
            unlocks once the TA has a way to pay for answers.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
