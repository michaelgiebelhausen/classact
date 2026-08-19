"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ABSENCE_CATEGORIES,
  DEFAULT_ATTENDANCE_POLICY,
  type AttendancePolicy,
} from "@/lib/absences";
import { updateAttendancePolicy } from "@/server/actions/absences";
import type { AbsenceCategory } from "@/types/db";

/**
 * The professor's attendance policy: what the syllabus says, plus the few
 * settings the AI applies mechanically. Students who report an absence get
 * an immediate excused/unexcused answer under this policy; the professor
 * only hears about appeals.
 */
export function AttendancePolicyTab({
  courseId,
  initial,
}: {
  courseId: string;
  initial: AttendancePolicy;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial.text);
  const [excused, setExcused] = useState<Set<AbsenceCategory>>(
    new Set(initial.excusedCategories)
  );
  const [docsFor, setDocsFor] = useState<Set<AbsenceCategory>>(
    new Set(initial.docsRequiredFor)
  );
  const [noticeHours, setNoticeHours] = useState(String(initial.advanceNoticeHours));
  const [freeUnexcused, setFreeUnexcused] = useState(String(initial.freeUnexcused));
  const [saving, setSaving] = useState(false);

  function toggle(
    set: Set<AbsenceCategory>,
    setter: (s: Set<AbsenceCategory>) => void,
    key: AbsenceCategory
  ) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  async function save() {
    setSaving(true);
    let result: Awaited<ReturnType<typeof updateAttendancePolicy>>;
    try {
      result = await updateAttendancePolicy(courseId, {
        text,
        excusedCategories: Array.from(excused),
        docsRequiredFor: Array.from(docsFor),
        // A cleared field is "unset", not zero — Number("") is 0, which
        // would silently mean "no notice expected" / "no free absences".
        advanceNoticeHours:
          noticeHours.trim() === ""
            ? DEFAULT_ATTENDANCE_POLICY.advanceNoticeHours
            : Number(noticeHours),
        freeUnexcused:
          freeUnexcused.trim() === ""
            ? DEFAULT_ATTENDANCE_POLICY.freeUnexcused
            : Number(freeUnexcused),
      });
    } catch {
      toast.error("Couldn't reach the server — try again.");
      return;
    } finally {
      setSaving(false);
    }
    if (result.ok) {
      // Show what was actually stored: the server clamps the numbers and
      // substitutes its default paragraph for empty text, so the form would
      // otherwise keep displaying a value that isn't in force.
      const stored = result.data?.policy;
      if (stored) {
        setText(stored.text);
        setExcused(new Set(stored.excusedCategories));
        setDocsFor(new Set(stored.docsRequiredFor));
        setNoticeHours(String(stored.advanceNoticeHours));
        setFreeUnexcused(String(stored.freeUnexcused));
      }
      toast.success("Attendance policy saved. Absence reports are judged against it from now on.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  function resetToDefault() {
    const d = DEFAULT_ATTENDANCE_POLICY;
    setText(d.text);
    setExcused(new Set(d.excusedCategories));
    setDocsFor(new Set(d.docsRequiredFor));
    setNoticeHours(String(d.advanceNoticeHours));
    setFreeUnexcused(String(d.freeUnexcused));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance policy</CardTitle>
        <CardDescription>
          Students report absences here instead of emailing you. ClassAct
          applies this policy and tells them excused or unexcused on the spot;
          you only hear about appeals. Anything a student attaches is assessed
          and discarded — never stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-1.5">
          <Label htmlFor="policy-text">Your policy, in your words</Label>
          <textarea
            id="policy-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={4000}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Paste the attendance section of your syllabus."
          />
          <p className="text-xs text-muted-foreground">
            This is what the AI reads first. The settings below handle the
            mechanical parts so it doesn&apos;t have to guess.
          </p>
        </div>

        <div className="grid gap-2">
          <Label>Reasons you treat as excused</Label>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {ABSENCE_CATEGORIES.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={excused.has(c.key)}
                  onChange={() => toggle(excused, setExcused, c.key)}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Reasons that need documentation to be excused</Label>
          <p className="text-xs text-muted-foreground">
            A report in one of these categories with nothing attached is
            recorded as unexcused automatically — the student can appeal once
            they have something. Documents are assessed for authenticity and
            then discarded.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {ABSENCE_CATEGORIES.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={docsFor.has(c.key)}
                  onChange={() => toggle(docsFor, setDocsFor, c.key)}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="notice-hours">Notice expected for planned absences</Label>
            <div className="flex items-center gap-2">
              <Input
                id="notice-hours"
                type="number"
                min={0}
                max={720}
                value={noticeHours}
                onChange={(e) => setNoticeHours(e.target.value)}
                className="max-w-[120px]"
              />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Illness and bereavement aren&apos;t held to this; everything
              planned is.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="free-unexcused">Unexcused absences before it matters</Label>
            <Input
              id="free-unexcused"
              type="number"
              min={0}
              max={30}
              value={freeUnexcused}
              onChange={(e) => setFreeUnexcused(e.target.value)}
              className="max-w-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Shown to students so they know where they stand.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save policy"}
          </Button>
          <Button variant="ghost" size="sm" onClick={resetToDefault} disabled={saving}>
            Reset to the default policy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
