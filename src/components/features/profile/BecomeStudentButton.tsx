"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { becomeStudent } from "@/server/actions/profile";

/**
 * Way out of the professor role for someone who never meant to be in it.
 *
 * The mirror of BecomeProfessorButton, and the missing half of what used to be
 * a one-way door: a student who taps "professor" gets routed to the course
 * builder on every sign-in with no path to their class, and no amount of
 * clearing cookies helps because the role lives on their profile row.
 *
 * The server decides whether it's allowed — a real professor with students
 * enrolled is refused, with the reason shown here rather than swallowed.
 */
export function BecomeStudentButton({
  label = "I'm a student, not a professor",
  variant = "outline",
}: {
  label?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function switchRole() {
    setBusy(true);
    const result = await becomeStudent();
    setBusy(false);
    if (result.ok) {
      toast.success("You're set up as a student now.");
      router.push("/dashboard");
      router.refresh();
    } else {
      // Refusals here are explanatory ("47 students enrolled"), so they need
      // to stay on screen long enough to read.
      toast.error(result.error, { duration: 10_000 });
    }
  }

  return (
    <Button variant={variant} onClick={switchRole} disabled={busy}>
      {busy ? "Switching…" : label}
    </Button>
  );
}
