"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { updateIcebreakerFields, updateSchedule } from "@/server/actions/courses";
import { syncCanvasRoster } from "@/server/actions/canvas";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import { RoomDesigner } from "@/components/features/setup/RoomDesigner";
import type { RoomLayout } from "@/lib/roomlayout";
import type { RoomLocation } from "@/server/actions/rooms";

export interface ScheduleValue {
  days: number[];
  start: string | null;
  end: string | null;
  timezone: string | null;
  autoOpen: boolean;
}

interface EnrollmentItem {
  id: string;
  roster_name: string;
  roster_email: string;
  status: "invited" | "active";
}

interface Props {
  course: {
    id: string;
    name: string;
    join_code: string;
    icebreaker_fields: string[];
  };
  roomSetup: {
    hasExistingRoom: boolean;
    initialLayout: RoomLayout | null;
    initialLocation: RoomLocation | null;
    universitySuggestion: string;
  };
  schedule: ScheduleValue;
  enrollments: EnrollmentItem[];
  siteUrl: string;
}

export function CourseSetupTabs({
  course,
  roomSetup,
  schedule,
  enrollments,
  siteUrl,
}: Props) {
  return (
    <Tabs defaultValue="seatmap" className="w-full">
      <TabsList>
        <TabsTrigger value="seatmap">Room</TabsTrigger>
        <TabsTrigger value="schedule">Schedule</TabsTrigger>
        <TabsTrigger value="roster">Roster</TabsTrigger>
        <TabsTrigger value="icebreakers">Icebreakers</TabsTrigger>
        <TabsTrigger value="invite">Invite</TabsTrigger>
      </TabsList>
      <TabsContent value="seatmap">
        <RoomDesigner
          courseId={course.id}
          hasExistingRoom={roomSetup.hasExistingRoom}
          initialLayout={roomSetup.initialLayout}
          initialLocation={roomSetup.initialLocation}
          universitySuggestion={roomSetup.universitySuggestion}
        />
      </TabsContent>
      <TabsContent value="schedule">
        <ScheduleTab courseId={course.id} initial={schedule} />
      </TabsContent>
      <TabsContent value="roster">
        <RosterTab courseId={course.id} initial={enrollments} />
      </TabsContent>
      <TabsContent value="icebreakers">
        <IcebreakerTab courseId={course.id} initialKeys={course.icebreaker_fields} />
      </TabsContent>
      <TabsContent value="invite">
        <InviteTab course={course} enrollments={enrollments} siteUrl={siteUrl} />
      </TabsContent>
    </Tabs>
  );
}

/* ---------------- Schedule (auto-open sessions) ---------------- */

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ScheduleTab({
  courseId,
  initial,
}: {
  courseId: string;
  initial: ScheduleValue;
}) {
  const router = useRouter();
  const [days, setDays] = useState<Set<number>>(() => new Set(initial.days));
  // Postgres `time` comes back as "09:30:00"; <input type="time"> wants "09:30".
  const [start, setStart] = useState(initial.start?.slice(0, 5) ?? "");
  const [end, setEnd] = useState(initial.end?.slice(0, 5) ?? "");
  const [autoOpen, setAutoOpen] = useState(initial.autoOpen);
  const [saving, setSaving] = useState(false);

  const browserTz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";
  const timezone = initial.timezone ?? browserTz;

  function toggleDay(day: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const result = await updateSchedule(courseId, {
      days: Array.from(days),
      start: start || null,
      end: end || null,
      timezone,
      autoOpen,
    });
    setSaving(false);
    if (result.ok) {
      toast.success(
        days.size === 0
          ? "Schedule cleared — sessions open manually."
          : "Schedule saved."
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Class schedule</CardTitle>
        <CardDescription>
          Set when this class meets and check-in opens itself 15 minutes
          before start — nobody has to press a button. You can still open or
          close a session manually any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <Label>Meeting days</Label>
          <div className="flex gap-1">
            {DAY_LABELS.map((label, day) => (
              <Button
                key={label}
                type="button"
                size="sm"
                variant={days.has(day) ? "default" : "outline"}
                onClick={() => toggleDay(day)}
                aria-pressed={days.has(day)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="meeting-start">Starts</Label>
            <Input
              id="meeting-start"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-32"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="meeting-end">Ends</Label>
            <Input
              id="meeting-end"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-32"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={autoOpen}
              onChange={(e) => setAutoOpen(e.target.checked)}
            />
            Open check-in automatically
          </label>
        </div>

        <p className="text-sm text-muted-foreground">
          Times are in <span className="font-medium">{timezone}</span>
          {initial.timezone ? "" : " (detected from your browser)"}.
        </p>

        <Button onClick={save} disabled={saving} className="w-fit">
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ---------------- Roster (TASK-022) ---------------- */

function RosterTab({
  courseId,
  initial,
}: {
  courseId: string;
  initial: EnrollmentItem[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [canvasId, setCanvasId] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function handleCanvasSync() {
    if (!canvasId.trim()) return;
    setSyncing(true);
    const result = await syncCanvasRoster({
      courseId,
      canvasCourseId: canvasId.trim(),
    });
    setSyncing(false);
    if (result.ok && result.data) {
      toast.success(
        `Synced ${result.data.imported} student(s) from Canvas${
          result.data.skipped ? `, skipped ${result.data.skipped} already added` : ""
        }.`
      );
      if (result.data.photosStored > 0) {
        toast.message(
          `Ported ${result.data.photosStored} Canvas photo(s) — faces show in the name games, directory, and seat map now.`
        );
      }
      if (result.data.noEmail > 0) {
        toast.message(
          `${result.data.noEmail} student(s) had no shared email and were skipped.`
        );
      }
      router.refresh();
    } else {
      toast.error(result.ok ? "Sync failed." : result.error);
    }
  }

  async function handleFile(file: File) {
    setImporting(true);
    const csv = await file.text();
    const res = await fetch("/api/roster/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, csv }),
    });
    const json = await res.json();
    setImporting(false);
    if (!res.ok) {
      toast.error(json.error ?? "Import failed.");
      return;
    }
    toast.success(`Imported ${json.imported}, skipped ${json.skipped}.`);
    if (json.details?.length) {
      toast.message(
        `${json.details.length} row(s) had problems — first: line ${json.details[0].line}: ${json.details[0].reason}`
      );
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster</CardTitle>
        <CardDescription>
          Upload a CSV with name and email columns — export it straight from
          Canvas or Blackboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? "Importing…" : "Upload roster CSV"}
          </Button>
        </div>

        <div className="grid gap-2 rounded-lg border border-dashed p-4">
          <Label htmlFor="canvasId">Or sync from Canvas</Label>
          <p className="text-sm text-muted-foreground">
            Paste your Canvas course ID — the number in your course URL, e.g.{" "}
            <span className="font-mono">…/courses/</span>
            <span className="font-mono font-semibold">123456</span>.
          </p>
          <div className="flex gap-2">
            <Input
              id="canvasId"
              inputMode="numeric"
              placeholder="123456"
              value={canvasId}
              onChange={(e) => setCanvasId(e.target.value.replace(/[^0-9]/g, ""))}
              className="max-w-[160px] font-mono"
            />
            <Button
              variant="outline"
              onClick={handleCanvasSync}
              disabled={syncing || !canvasId}
            >
              {syncing ? "Syncing…" : "Sync from Canvas"}
            </Button>
          </div>
        </div>

        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No students yet. Upload your roster and every student gets a
            pre-made spot to activate.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initial.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.roster_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.roster_email}
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.status === "active" ? "default" : "secondary"}>
                      {e.status === "active" ? "Active" : "Invited"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Icebreakers (TASK-023) ---------------- */

function IcebreakerTab({
  courseId,
  initialKeys,
}: {
  courseId: string;
  initialKeys: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialKeys));
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const result = await updateIcebreakerFields(courseId, Array.from(selected));
    setSaving(false);
    if (result.ok) toast.success("Icebreakers saved.");
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Icebreakers</CardTitle>
        <CardDescription>
          Pick what students answer during onboarding. Their answers power the
          name games.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          {ICEBREAKER_CATALOG.map((f) => (
            <label
              key={f.key}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={selected.has(f.key)}
                onChange={() => toggle(f.key)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{f.label}</span>
                <span className="block text-sm text-muted-foreground">
                  {f.prompt}
                </span>
              </span>
            </label>
          ))}
        </div>
        <Button onClick={save} disabled={saving} className="w-fit">
          {saving ? "Saving…" : "Save icebreakers"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ---------------- Invite + join code (TASK-024/025) ---------------- */

function InviteTab({
  course,
  enrollments,
  siteUrl,
}: {
  course: { id: string; name: string; join_code: string };
  enrollments: EnrollmentItem[];
  siteUrl: string;
}) {
  const [sending, setSending] = useState(false);
  const joinUrl = `${siteUrl}/join/${encodeURIComponent(course.join_code)}`;
  const invitedCount = enrollments.filter((e) => e.status === "invited").length;

  const activationMessage = `${course.name} is using ClassAct this term for seat check-in.\n\nJoin here (takes ~2 minutes): ${joinUrl}\nJoin code: ${course.join_code}\n\nTap your seat, meet the people next to you, and get on with your day.`;

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied.`);
  }

  async function sendInvites() {
    setSending(true);
    const res = await fetch("/api/invites/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: course.id }),
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok) {
      toast.error(json.error ?? "Couldn't send invites.");
      return;
    }
    if (json.sent > 0) toast.success(`Sent ${json.sent} invite(s).`);
    if (json.failed > 0) {
      toast.message(
        `${json.failed} invite(s) not sent${json.error ? ` — ${json.error}` : ""}. Share the join link below instead.`
      );
    }
    if (json.sent === 0 && json.failed === 0) {
      toast.message("Everyone on the roster is already active.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite students</CardTitle>
        <CardDescription>
          Email everyone still marked “Invited”, or just share the join link
          yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-2">
          <Label>Join code</Label>
          <div className="flex items-center gap-2">
            <span className="rounded-lg border bg-muted px-4 py-2 font-mono text-lg tracking-widest">
              {course.join_code}
            </span>
            <Button variant="outline" size="sm" onClick={() => copy(course.join_code, "Join code")}>
              Copy code
            </Button>
            <Button variant="outline" size="sm" onClick={() => copy(joinUrl, "Join link")}>
              Copy link
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Ready-to-send message</Label>
          <pre className="whitespace-pre-wrap rounded-lg border bg-muted p-3 text-sm">
            {activationMessage}
          </pre>
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => copy(activationMessage, "Message")}
          >
            Copy message
          </Button>
        </div>

        <div className="grid gap-2">
          <Label>Email invites</Label>
          <p className="text-sm text-muted-foreground">
            {invitedCount} student(s) haven&apos;t activated yet.
          </p>
          <Button onClick={sendInvites} disabled={sending || invitedCount === 0} className="w-fit">
            {sending ? "Sending…" : `Email ${invitedCount} invite(s)`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
