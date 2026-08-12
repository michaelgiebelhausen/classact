"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { normalizeCanvasBaseUrl } from "@/lib/canvasurl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { syncCanvasRoster } from "@/server/actions/canvas";
import {
  disconnectCanvas,
  listCanvasCourses,
  listCanvasSections,
  saveCanvasConnection,
  type CanvasConnectionView,
} from "@/server/actions/canvassettings";
import type { CanvasSection, CanvasTeacherCourse } from "@/server/canvascreds";

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
  // Lets a professor connect their own account even when the server has a
  // fallback token configured — that token only ever sees its owner's
  // courses, so "connected" isn't the same as "connected as you".
  const [showConnect, setShowConnect] = useState(false);
  // Walkthrough position. `confirmedHost` is the normalized https origin from
  // step 1 — it powers the deep link straight to the professor's own Canvas
  // token page, so steps 2–3 never ask them to hunt through menus.
  const [connectStep, setConnectStep] = useState(1);
  const [confirmedHost, setConfirmedHost] = useState<string | null>(null);

  function confirmHost() {
    const normalized = normalizeCanvasBaseUrl(baseUrl);
    if (!normalized) {
      toast.error(
        "That doesn't look like a Canvas address — try something like yourschool.instructure.com."
      );
      return;
    }
    setConfirmedHost(normalized);
    setBaseUrl(normalized.replace("https://", ""));
    setConnectStep(2);
  }
  // Cross-listed Canvas shell: pick which sections belong in THIS course.
  const [picker, setPicker] = useState<{
    canvasCourseId: string;
    courseName: string | null;
    sections: CanvasSection[];
    selected: Set<string>;
  } | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function connect() {
    if (!token.trim()) {
      toast.error("Paste the access token from Canvas first.");
      return;
    }
    setSaving(true);
    const result = await saveCanvasConnection({
      baseUrl: confirmedHost ?? baseUrl,
      token,
    });
    setSaving(false);
    if (result.ok && result.data) {
      setToken("");
      setShowConnect(false);
      setConnectStep(1);
      setCourses(null);
      toast.success(`Connected to Canvas as ${result.data.name}.`);
      router.refresh();
      // Keep the walkthrough moving: show their courses right away instead
      // of leaving them at a "connected" card wondering what's next.
      void loadCourses();
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

  /**
   * Check the course's sections before syncing: one section syncs straight
   * through; a cross-listed shell opens the picker instead.
   */
  async function beginSync(canvasCourseId: string, courseName?: string) {
    // One sync flow at a time — no second check, no clobbering an open picker.
    if (!canvasCourseId || syncingId || checkingId || picker) return;
    setCheckingId(canvasCourseId);
    let result: Awaited<ReturnType<typeof listCanvasSections>>;
    try {
      result = await listCanvasSections(canvasCourseId);
    } catch {
      toast.error("Couldn't reach Canvas — try again.");
      return;
    } finally {
      setCheckingId(null);
    }
    if (!result.ok || !result.data) {
      toast.error(result.ok ? "Couldn't check that course." : result.error);
      return;
    }
    if (result.data.sections.length <= 1) {
      void sync(canvasCourseId);
      return;
    }
    setPicker({
      canvasCourseId,
      courseName: courseName ?? null,
      sections: result.data.sections,
      selected: new Set(result.data.sections.map((s) => s.id)),
    });
  }

  async function sync(canvasCourseId: string, sectionIds?: string[]) {
    if (syncingId) return;
    setSyncingId(canvasCourseId);
    const result = await syncCanvasRoster({ courseId, canvasCourseId, sectionIds });
    setSyncingId(null);
    if (result.ok && result.data) {
      setPicker(null);
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

  if (!connection.connected || showConnect) {
    const hostLabel = confirmedHost?.replace("https://", "");
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

        {/* Step 1 — where is your Canvas? Done: a one-line receipt. */}
        {connectStep > 1 && confirmedHost ? (
          <button
            type="button"
            className="flex items-center gap-2 text-left text-sm"
            onClick={() => setConnectStep(1)}
            disabled={saving}
          >
            <CheckCircle2 className="size-4 shrink-0 text-green-600" />
            <span className="text-muted-foreground">
              Your Canvas: <span className="font-medium text-foreground">{hostLabel}</span>
            </span>
            <span className="text-xs text-muted-foreground underline">change</span>
          </button>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="canvas-url">
              Step 1 of 3 — Your school&apos;s Canvas web address
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="canvas-url"
                placeholder="yourschool.instructure.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmHost()}
                className="max-w-sm"
                autoComplete="off"
              />
              <Button onClick={confirmHost}>Continue</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              What&apos;s in your browser&apos;s address bar when you&apos;re in
              Canvas. Pasting a full course link is fine — we&apos;ll trim it.
            </p>
          </div>
        )}

        {/* Step 2 — the deep link does the wayfinding, not the professor. */}
        {connectStep === 2 && confirmedHost && (
          <div className="grid gap-2">
            <Label>Step 2 of 3 — Create your access token</Label>
            <div>
              <Button asChild variant="secondary">
                <a
                  href={`${confirmedHost}/profile/settings`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 size-4" /> Open your Canvas
                  settings
                </a>
              </Button>
            </div>
            <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
              <li>
                That page opens in a new tab (sign in to Canvas if it asks).
              </li>
              <li>
                Scroll to <span className="font-medium">Approved Integrations</span>{" "}
                and click <span className="font-medium">+ New Access Token</span>.
              </li>
              <li>
                Purpose: <span className="font-medium">ClassAct</span>. Leave the
                expiry blank, or pick the end of term.
              </li>
              <li>
                Click <span className="font-medium">Generate Token</span> and{" "}
                <span className="font-medium">copy it</span> — Canvas shows it
                only once.
              </li>
            </ol>
            <div>
              <Button onClick={() => setConnectStep(3)}>
                I copied my token
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — paste, and we verify with Canvas before storing. */}
        {connectStep === 3 && (
          <div className="grid gap-1.5">
            <Label htmlFor="canvas-token">Step 3 of 3 — Paste the token here</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="canvas-token"
                type="password"
                placeholder="paste your access token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !saving && connect()}
                className="max-w-sm font-mono"
                autoComplete="off"
                autoFocus
              />
              <Button onClick={connect} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Checking
                    with Canvas…
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
            <button
              type="button"
              className="justify-self-start text-xs text-muted-foreground underline"
              onClick={() => setConnectStep(2)}
              disabled={saving}
            >
              Back — I still need to create the token
            </button>
          </div>
        )}

        {/* Escape hatch when this panel was opened over a working fallback. */}
        {connection.connected && showConnect && (
          <button
            type="button"
            className="justify-self-start text-xs text-muted-foreground underline"
            onClick={() => {
              setShowConnect(false);
              setConnectStep(1);
            }}
            disabled={saving}
          >
            Never mind — keep using the current connection
          </button>
        )}
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
          {connection.source === "professor" ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setShowConnect(true)}
            >
              Connect my own account
            </Button>
          )}
        </div>
      </div>

      {connection.source === "env" && (
        <p className="rounded-lg border border-dashed p-2 text-xs text-muted-foreground">
          This is the server&apos;s Canvas token, so the list below shows{" "}
          <span className="font-medium">its owner&apos;s</span> courses — not
          yours. Connect your own account to see the classes you teach.
        </p>
      )}

      {courses?.length === 0 && (
        <p className="rounded-lg border border-dashed p-2 text-sm text-muted-foreground">
          Canvas returned no active courses for this token
          {connection.source === "env"
            ? " — it belongs to the server, not to you. Connect your own account above."
            : ". Check that you're listed as the teacher, or paste the course ID below."}
        </p>
      )}

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
                onClick={() => void beginSync(c.id, c.name)}
                disabled={syncingId !== null || checkingId !== null}
              >
                {syncingId === c.id || checkingId === c.id
                  ? "Syncing…"
                  : "Sync roster"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {picker && (
        <div className="grid gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div>
            <p className="text-sm font-medium">
              {picker.courseName ?? "This Canvas course"} is cross-listed —{" "}
              {picker.sections.length} sections in one Canvas shell.
            </p>
            <p className="text-xs text-muted-foreground">
              Sections that meet at different times work best as separate
              ClassAct courses (each gets its own seat map and check-in).
              Pick the section(s) that meet as{" "}
              <span className="font-medium">this</span> course; repeat for
              the others in their own courses.
            </p>
          </div>
          <div className="grid gap-1.5">
            {picker.sections.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={picker.selected.has(s.id)}
                  onChange={(e) => {
                    setPicker((prev) => {
                      if (!prev) return prev;
                      const selected = new Set(prev.selected);
                      if (e.target.checked) selected.add(s.id);
                      else selected.delete(s.id);
                      return { ...prev, selected };
                    });
                  }}
                />
                <span className="min-w-0 flex-1 break-words" title={s.name}>
                  {s.name}
                </span>
                {s.totalStudents !== null && (
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {s.totalStudents} students
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                void sync(picker.canvasCourseId, [...picker.selected])
              }
              disabled={picker.selected.size === 0 || syncingId !== null}
            >
              {syncingId === picker.canvasCourseId
                ? "Syncing…"
                : `Sync ${picker.selected.size} ${
                    picker.selected.size === 1 ? "section" : "sections"
                  }`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setPicker(null)}
              disabled={syncingId !== null}
            >
              Cancel
            </Button>
          </div>
        </div>
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
          onClick={() => void beginSync(manualId.trim())}
          disabled={syncingId !== null || checkingId !== null || !manualId}
        >
          Sync
        </Button>
      </div>
    </div>
  );
}
