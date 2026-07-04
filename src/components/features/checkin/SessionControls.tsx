"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openSession, closeSession } from "@/server/actions/checkin";

export function SessionControls({
  courseId,
  sessionId,
}: {
  courseId: string;
  sessionId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleOpen() {
    setBusy(true);
    const result = await openSession(courseId);
    setBusy(false);
    if (result.ok) {
      toast.success("Session open — students can check in.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleClose() {
    if (!sessionId) return;
    setBusy(true);
    const result = await closeSession(courseId, sessionId);
    setBusy(false);
    if (result.ok) {
      toast.success("Session closed.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return sessionId ? (
    <Button variant="outline" onClick={handleClose} disabled={busy}>
      {busy ? "Closing…" : "Close today's session"}
    </Button>
  ) : (
    <Button onClick={handleOpen} disabled={busy}>
      {busy ? "Opening…" : "Open today's session"}
    </Button>
  );
}
