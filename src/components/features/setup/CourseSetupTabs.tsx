"use client";

import { useMemo, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { generateSeatMap } from "@/server/actions/seatmap";
import { updateIcebreakerFields } from "@/server/actions/courses";
import { syncCanvasRoster } from "@/server/actions/canvas";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import { buildSeatGrid } from "@/lib/seatlabels";

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
  seatDims: { rows: number; cols: number } | null;
  enrollments: EnrollmentItem[];
  siteUrl: string;
}

export function CourseSetupTabs({ course, seatDims, enrollments, siteUrl }: Props) {
  return (
    <Tabs defaultValue="seatmap" className="w-full">
      <TabsList>
        <TabsTrigger value="seatmap">Seat map</TabsTrigger>
        <TabsTrigger value="roster">Roster</TabsTrigger>
        <TabsTrigger value="icebreakers">Icebreakers</TabsTrigger>
        <TabsTrigger value="invite">Invite</TabsTrigger>
      </TabsList>
      <TabsContent value="seatmap">
        <SeatMapTab courseId={course.id} seatDims={seatDims} />
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

/* ---------------- Seat map (TASK-020) ---------------- */

function SeatMapTab({
  courseId,
  seatDims,
}: {
  courseId: string;
  seatDims: { rows: number; cols: number } | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(seatDims?.rows ?? 6);
  const [cols, setCols] = useState(seatDims?.cols ?? 8);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useMemo(() => {
    try {
      return buildSeatGrid(rows, cols);
    } catch {
      return [];
    }
  }, [rows, cols]);

  async function save(force = false) {
    setSaving(true);
    const result = await generateSeatMap(courseId, { rows, cols }, force);
    setSaving(false);
    if (result.ok) {
      toast.success(`Room saved — ${result.data?.seatCount} seats.`);
      setConfirmOpen(false);
      router.refresh();
    } else if (result.error.includes("Confirm to continue")) {
      setConfirmOpen(true);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your room</CardTitle>
        <CardDescription>
          Rows count from the front of the room. Row A, seat 1 is front-left.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="rows">Rows</Label>
            <Input
              id="rows"
              type="number"
              min={1}
              max={40}
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cols">Seats per row</Label>
            <Input
              id="cols"
              type="number"
              min={1}
              max={40}
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button onClick={() => save(false)} disabled={saving || preview.length === 0}>
            {saving ? "Saving…" : seatDims ? "Rebuild room" : "Save room"}
          </Button>
        </div>

        {preview.length > 0 && (
          <div className="overflow-x-auto">
            <p className="mb-2 text-center text-xs uppercase tracking-wide text-muted-foreground">
              Front of room
            </p>
            <div
              className="grid w-max gap-1"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {preview.map((s) => (
                <div
                  key={s.label}
                  className="flex h-8 w-10 items-center justify-center rounded border bg-muted text-[10px] text-muted-foreground"
                >
                  {s.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild the room?</DialogTitle>
            <DialogDescription>
              This room already has recorded check-ins. Rebuilding the map
              erases them. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Keep the current room
            </Button>
            <Button variant="destructive" onClick={() => save(true)} disabled={saving}>
              Rebuild and erase check-ins
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
