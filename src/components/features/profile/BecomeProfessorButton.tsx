"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { becomeProfessor } from "@/server/actions/profile";

/**
 * Recovery path for anyone who landed in a student account but is actually
 * teaching — accounts created before sign-up asked, or a mis-click.
 */
export function BecomeProfessorButton({
  label = "I'm teaching a course",
  variant = "outline",
}: {
  label?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function switchRole() {
    setBusy(true);
    const result = await becomeProfessor();
    setBusy(false);
    if (result.ok) {
      toast.success("You're set up as a professor — create your first course.");
      router.push("/course/new");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Button variant={variant} onClick={switchRole} disabled={busy}>
      {busy ? "Switching…" : label}
    </Button>
  );
}
