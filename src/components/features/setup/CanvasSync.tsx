"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Link2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { syncCanvasRoster } from "@/server/actions/canvas";
import {
  disconnectCanvas,
  listCanvasCourses,
  saveCanvasConnection,
  type CanvasConnectionView,
} from "@/server/actions/canvassettings";
import type { CanvasTeacherCourse } from "@/server/canvascreds";

/**
 * The Canvas onboarding + sync card. Not connected: a three-step guided
 * connect (school address → token walkthrough → paste). Connected: list the
 * professor's own Canvas courses so syncing is one click — no hunting for a
 * course ID in a URL (manual ID entry stays as a fallback).
 */

interface Props {
  courseId: string;
  connection: CanvasConnectionView;
}

export function CanvasSync({ courseId, connection }: Props) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<CanvasTeacherCourse[] | null>(null);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  async function connect() {
    if (!baseUrl.trim() || !token.trim()) {
      toast.error("Fill in your school's Canvas address and the access token.");
      return;
    }
    setSaving(true);
    const result = await saveCanvasConnection({ baseUrl, token });
    setSaving(false);
    if (result.ok && result.data) {
      setToken("");
      toast.success(`Connected to Canvas as ${result.data.name}.`);
      router.refresh();
    } else {
      toast.error(result.ok ? "Couldn't connect." : result.error);
    }
  }

  async function loadCourses() {
    setLoadingCourses(true);
    const result = await listCanvasCourses();
    setLoadingCourses(false);
    if (result.ok && result.data) {
      setCourses(result.data.courses);
      if (result.data.courses.length === 0) {
        toast.message(
          "Canvas listed no active courses you teach — you can still paste a course ID below."
        );
      }
    } else {
      toast.error(result.ok ? "Couldn't list courses." : result.error);
    }
  }

  async function sync(canvasCourseId: string) {
    setSyncingId(canvasCourseId);
    const result = await syncCanvasRoster({ courseId, canvasCourseId });
    setSyncingId(null);
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

  async function handleDisconnect() {
    setDisconnecting(true);
    const result = await disconnectCanvas();
    setDisconnecting(false);
    if (result.ok) {
      setCourses(null);
      toast.success("Canvas disconnected — the token has been deleted.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  if (!connection.connected) {
    return (
      <div className="grid gap-4 rounded-lg border border-dashed p-4">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Link2 className="size-4" /> Connect Canvas — two minutes, once
          </p>
          <p className="text-sm text-muted-foreground">
            Pull your roster (names, emails, even photos) straight from
            Canvas — no CSV wrangling, and it works for every course you
            teach.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="canvas-url">1. Your school&apos;s Canvas web address</Label>
          <Input
            id="canvas-url"
            placeholder="yourschool.instructure.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="max-w-sm"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            The address you see when you&apos;re in Canvas — just the first
            part, no /courses/… needed.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label>2. Create an access token in Canvas</Label>
          <p className="text-sm text-muted-foreground">
            In Canvas, click <span className="font-medium">Account</span> (top
            of the left sidebar) → <span className="font-medium">Settings</span>,
            scroll to <span className="font-medium">Approved Integrations</span>,
            and click <span className="font-medium">+ New Access Token</span>.
            Purpose: &ldquo;ClassAct&rdquo;; leave the expiry blank (or pick the
            end of term). Click{" "}
            <span className="font-medium">Generate Token</span> and copy it —
            Canvas only shows it once.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="canvas-token">3. Paste the token here</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="canvas-token"
              type="password"
              placeholder="paste your access token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="max-w-sm font-mono"
              autoComplete="off"
            />
            <Button onClick={connect} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Checking with
                  Canvas…
                </>
              ) : (
                "Connect Canvas"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Your token is encrypted before it&apos;s stored and never shown
            again — only its last 4 characters. ClassAct uses it to read your
            course rosters, nothing else. Disconnect anytime.
          </p>
        </div>
      </div>
    );
  }

  const host = connection.baseUrl.replace(/^https?:\/\//, "");
  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4 text-green-600" /> Canvas connected
          </p>
          <p className="text-sm text-muted-foreground">
            {host}
            {connection.connectedName ? ` · ${connection.connectedName}` : ""}
            {connection.tokenLast4 ? ` · token ••••${connection.tokenLast4}` : ""}
            {connection.source === "env" ? " · using this server's Canvas token" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadCourses}
            disabled={loadingCourses}
          >
            {loadingCourses ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
              </>
            ) : courses ? (
              <>
                <RefreshCw className="mr-2 size-4" /> Refresh courses
              </>
            ) : (
              "Pick a course to sync"
            )}
          </Button>
          {connection.source === "professor" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {courses && courses.length > 0 && (
        <ul className="grid gap-2">
          {courses.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[c.courseCode, c.term].filter(Boolean).join(" · ") ||
                    `Canvas course ${c.id}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void sync(c.id)}
                disabled={syncingId !== null}
              >
                {syncingId === c.id ? "Syncing…" : "Sync roster"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="canvas-manual-id" className="text-xs text-muted-foreground">
            Or paste a Canvas course ID (the number in the course URL)
          </Label>
          <Input
            id="canvas-manual-id"
            inputMode="numeric"
            placeholder="123456"
            value={manualId}
            onChange={(e) => setManualId(e.target.value.replace(/[^0-9]/g, ""))}
            className="max-w-[160px] font-mono"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => void sync(manualId.trim())}
          disabled={syncingId !== null || !manualId}
        >
          Sync
        </Button>
      </div>
    </div>
  );
}
