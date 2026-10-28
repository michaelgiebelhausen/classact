"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enterStudentView, reopenPracticeAssignments } from "@/server/actions/studentview";
import { studentViewPath, type PracticeCourse } from "@/lib/studentview";

export function StudentViewControls({ taught, practices }: { taught: string[]; practices: PracticeCourse[] }) {
  const path = usePathname() ?? "";
  const courseId = path.match(/^\/course\/([^/]+)(?:\/|$)/)?.[1];
  const practice = practices.find(p => p.id === courseId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  if (!courseId || (!practice && !taught.includes(courseId))) return null;
  const source = practice?.practice_source_id ?? courseId;
  const returnPath = practice ? studentViewPath(path, practice.id, source, Object.fromEntries(Object.entries(practice.practice_routes).map(([a,b]) => [b,a]))) : path;
  async function enter(reset: boolean) {
    setBusy(true); setError("");
    try {
      const result = await enterStudentView(source, returnPath, reset, reset ? practice?.id : undefined);
      if (result.ok && result.data) window.location.assign(result.data.path);
      else { setError(result.ok ? "Could not open Student View." : result.error); setBusy(false); }
    } catch { setError("Student View could not open. Please try again."); setBusy(false); }
  }
  async function reopen() {
    setBusy(true); setError("");
    try {
      const result = await reopenPracticeAssignments(courseId!);
      if (result.ok) window.location.reload();
      else { setError(result.error); setBusy(false); }
    } catch { setError("Could not reopen the practice assignments."); setBusy(false); }
  }
  return <div data-practice={practice ? "true" : undefined} className="flex flex-wrap items-center gap-2">
    {practice ? <>
      <span className="text-sm font-semibold">Student view <span className="font-normal text-muted-foreground">· Private practice</span></span>
      <Button asChild size="sm" variant="outline"><a href={returnPath}>Exit student view</a></Button>
      <details className="relative">
        <summary className="cursor-pointer text-sm underline">Practice options</summary>
        <div className="absolute right-0 top-full z-50 mt-2 grid w-72 max-w-[80vw] gap-3 rounded-lg border bg-background p-4 shadow-lg">
          <p className="text-sm">Private course snapshot. Practice work is saved here only. No real classmates or grades are copied. AI and email delivery are disabled.</p>
          <p className="text-sm text-muted-foreground">Dates and assignment states match the snapshot. Reopen assignments to try submitting, or reset to copy the latest course content.</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void reopen()}>Reopen practice assignments for 7 days</Button>
          {confirmReset ? <><p className="text-sm">Discard all practice work and take a fresh snapshot?</p><Button size="sm" disabled={busy} onClick={() => void enter(true)}>Discard practice work and reset</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmReset(false)}>Cancel</Button></> : <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmReset(true)}>Reset practice student</Button>}
        </div>
      </details>
    </> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void enter(false)}><Eye className="size-4" />{busy ? "Opening…" : "Student view"}</Button>}
    {error && <p role="alert" className="max-w-xs text-sm text-destructive">{error}</p>}
  </div>;
}
