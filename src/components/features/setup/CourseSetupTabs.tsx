"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import type { CanvasConnectionView } from "@/server/actions/canvassettings";
import { CanvasSync } from "@/components/features/setup/CanvasSync";
import { ActivationPanel } from "@/components/features/setup/ActivationPanel";
import type { ActivationRow } from "@/server/actions/activation";
import {
  DeckManager,
  type DeckListItem,
} from "@/components/features/follow/DeckManager";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import {
  DEFAULT_INVITE_MESSAGE,
  DEFAULT_INVITE_SUBJECT,
  INVITE_MESSAGE_MAX,
  INVITE_SUBJECT_MAX,
  INVITE_TOKENS,
  renderInvite,
  validateInvite,
} from "@/lib/invitetemplate";
import { RoomDesigner } from "@/components/features/setup/RoomDesigner";
import { AttendancePolicyTab } from "@/components/features/setup/AttendancePolicyTab";
import type { AttendancePolicy } from "@/lib/absences";
import type { RoomLayout } from "@/lib/roomlayout";
import type { RoomLocation } from "@/server/actions/rooms";

export interface ScheduleValue {
  days: number[];
  start: string | null;
  end: string | null;
  timezone: string | null;
  autoOpen: boolean;
  /** Term bounds, "YYYY-MM-DD"; null = unbounded. */
  termStart: string | null;
  termEnd: string | null;
}

interface EnrollmentItem {
  id: string;
  roster_name: string;
  roster_email: string;
  status: "invited" | "active";
  /** Last invite attempt: when it was accepted, or why it wasn't (0026). */
  invited_at?: string | null;
  invite_error?: string | null;
}

interface Props {
  course: {
    id: string;
    name: string;
    join_code: string;
    icebreaker_fields: string[];
    /** Null = this course has never customized the invite (0026). */
    invite_subject: string | null;
    invite_message: string | null;
  };
  roomSetup: {
    hasExistingRoom: boolean;
    initialLayout: RoomLayout | null;
    initialLocation: RoomLocation | null;
    universitySuggestion: string;
  };
  schedule: ScheduleValue;
  enrollments: EnrollmentItem[];
  activation: ActivationRow[];
  siteUrl: string;
  canvasConnection: CanvasConnectionView;
  /** Slide decks for this course — same manager the Follow Along page uses. */
  decks: DeckListItem[];
  /** Parsed attendance policy the AI applies to self-reported absences. */
  attendancePolicy: AttendancePolicy;
}

export function CourseSetupTabs({
  course,
  roomSetup,
  schedule,
  enrollments,
  activation,
  siteUrl,
  canvasConnection,
  decks,
  attendancePolicy,
}: Props) {
  return (
    <Tabs defaultValue="seatmap" className="w-full">
      <TabsList>
        <TabsTrigger value="seatmap">Room</TabsTrigger>
        <TabsTrigger value="schedule">Schedule</TabsTrigger>
        <TabsTrigger value="attendance">Attendance</TabsTrigger>
        <TabsTrigger value="roster">Roster</TabsTrigger>
        <TabsTrigger value="slides">Slides</TabsTrigger>
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
      <TabsContent value="attendance">
        <AttendancePolicyTab courseId={course.id} initial={attendancePolicy} />
      </TabsContent>
      <TabsContent value="roster">
        <RosterTab
          courseId={course.id}
          initial={enrollments}
          canvasConnection={canvasConnection}
        />
      </TabsContent>
      <TabsContent value="slides">
        <DeckManager courseId={course.id} decks={decks} />
      </TabsContent>
      <TabsContent value="icebreakers">
        <IcebreakerTab courseId={course.id} initialKeys={course.icebreaker_fields} />
      </TabsContent>
      <TabsContent value="invite">
        <InviteTab
          course={course}
          enrollments={enrollments}
          activation={activation}
          siteUrl={siteUrl}
        />
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
  const [termStart, setTermStart] = useState(initial.termStart ?? "");
  const [termEnd, setTermEnd] = useState(initial.termEnd ?? "");
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
      termStart: termStart || null,
      termEnd: termEnd || null,
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
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="term-start">First day of class</Label>
            <Input
              id="term-start"
              type="date"
              value={termStart}
              onChange={(e) => setTermStart(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="term-end">Last day of class</Label>
            <Input
              id="term-end"
              type="date"
              value={termEnd}
              onChange={(e) => setTermEnd(e.target.value)}
              className="w-44"
            />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">
            Check-in stops opening itself outside these dates. Leave blank
            for a course that runs indefinitely.
          </p>
        </div>

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
  canvasConnection,
}: {
  courseId: string;
  initial: EnrollmentItem[];
  canvasConnection: CanvasConnectionView;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

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
          Sync straight from Canvas (names, emails, photos) — or upload a CSV
          with name and email columns.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <CanvasSync courseId={courseId} connection={canvasConnection} />

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
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? "Importing…" : "Or upload a roster CSV"}
          </Button>
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

/** One student's outcome from the most recent send in this browser session. */
type SendOutcome = {
  enrollmentId: string;
  name: string;
  sent: boolean;
  error?: string;
};

function InviteTab({
  course,
  enrollments,
  activation,
  siteUrl,
}: {
  course: Props["course"];
  enrollments: EnrollmentItem[];
  activation: ActivationRow[];
  siteUrl: string;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState(
    course.invite_subject ?? DEFAULT_INVITE_SUBJECT
  );
  const [message, setMessage] = useState(
    course.invite_message ?? DEFAULT_INVITE_MESSAGE
  );
  const [outcomes, setOutcomes] = useState<SendOutcome[] | null>(null);

  const joinUrl = `${siteUrl}/join/${encodeURIComponent(course.join_code)}`;
  const pending = enrollments.filter((e) => e.status === "invited");
  const failedEarlier = pending.filter((e) => e.invite_error);

  // What one student will actually receive. Rendering the preview through the
  // same function the server uses is the point — the old page showed a
  // hand-written approximation that had already drifted from the real email.
  const previewVars = {
    name: pending[0]?.roster_name ?? "Jordan Rivera",
    course: course.name,
    link: joinUrl,
    code: course.join_code,
  };
  const preview = renderInvite(message, previewVars);

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied.`);
  }

  async function send(enrollmentIds?: string[]) {
    const checked = validateInvite({ subject, message });
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }

    setSending(true);
    setOutcomes(null);
    const res = await fetch("/api/invites/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId: course.id,
        subject: checked.subject,
        message: checked.message,
        ...(enrollmentIds ? { enrollmentIds } : {}),
      }),
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok) {
      toast.error(json.error ?? "Couldn't send invites.");
      return;
    }

    setOutcomes(json.results ?? []);
    if (json.sent > 0) toast.success(`Sent ${json.sent} invite(s).`);
    if (json.failed > 0) {
      toast.error(
        `${json.failed} invite(s) didn't go out — see who below, then retry just those.`
      );
    }
    if (json.sent === 0 && json.failed === 0) {
      toast.message("Everyone on the roster is already active.");
    }
    // Pull fresh invited_at / invite_error onto the roster.
    router.refresh();
  }

  const justFailed = (outcomes ?? []).filter((o) => !o.sent);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite students</CardTitle>
        <CardDescription>
          Write the email, send it to everyone still marked “Invited”, or share
          the join link yourself.
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
          <Label htmlFor="invite-subject">Subject</Label>
          <Input
            id="invite-subject"
            value={subject}
            maxLength={INVITE_SUBJECT_MAX}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="invite-message">Message</Label>
          <Textarea
            id="invite-message"
            value={message}
            rows={12}
            maxLength={INVITE_MESSAGE_MAX}
            className="font-mono text-sm"
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Fill-ins, replaced per student:{" "}
            {INVITE_TOKENS.map((t, i) => (
              <span key={t.token}>
                {i > 0 && ", "}
                <code className="rounded bg-muted px-1">{t.token}</code> ={" "}
                {t.label.toLowerCase()}
              </span>
            ))}
            . Your wording saves when you send.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => copy(preview, "Message")}>
              Copy message
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSubject(DEFAULT_INVITE_SUBJECT);
                setMessage(DEFAULT_INVITE_MESSAGE);
                toast.message("Reset to the default wording — send to save it.");
              }}
            >
              Reset to default
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Preview</Label>
          <p className="text-sm text-muted-foreground">
            What {previewVars.name} receives.
          </p>
          <div className="rounded-lg border bg-muted p-3 text-sm">
            <p className="font-medium">{renderInvite(subject, previewVars)}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{preview}</pre>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Email invites</Label>
          <p className="text-sm text-muted-foreground">
            {pending.length} student(s) haven&apos;t activated yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send()} disabled={sending || pending.length === 0}>
              {sending ? "Sending…" : `Email ${pending.length} invite(s)`}
            </Button>
            {failedEarlier.length > 0 && (
              <Button
                variant="outline"
                disabled={sending}
                onClick={() => send(failedEarlier.map((e) => e.id))}
              >
                Retry {failedEarlier.length} that failed
              </Button>
            )}
          </div>
          {justFailed.length > 0 && (
            <p className="text-sm text-destructive">
              Didn&apos;t go out: {justFailed.map((o) => o.name).join(", ")} —{" "}
              {justFailed[0].error}
            </p>
          )}
        </div>

        <ActivationPanel
          courseId={course.id}
          rows={activation}
          onReinvite={send}
          reinviting={sending}
        />
      </CardContent>
    </Card>
  );
}
