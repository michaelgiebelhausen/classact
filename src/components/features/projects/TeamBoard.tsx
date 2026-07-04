"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Clock,
  FileSignature,
  Inbox,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  assignTask,
  completeTask,
  createTeamTask,
  deleteTeamTask,
  reopenTask,
  updateTeamTask,
} from "@/server/actions/board";
import { formatMinutes } from "@/lib/projects";
import { cn } from "@/lib/utils";

export interface BoardMember {
  enrollmentId: string;
  name: string;
  role: "lead" | "member";
}

export interface BoardTask {
  id: string;
  title: string;
  description: string | null;
  estimatedMinutes: number;
  actualMinutes: number | null;
  status: "unassigned" | "assigned" | "done";
  assignedEnrollmentId: string | null;
  isContract: boolean;
  position: number;
}

interface Props {
  courseId: string;
  teamId: string;
  teamName: string;
  members: BoardMember[];
  tasks: BoardTask[];
  /** Null when the professor is viewing. */
  myEnrollmentId: string | null;
}

type DialogMode =
  | { kind: "view"; task: BoardTask }
  | { kind: "complete"; task: BoardTask; minutes: number }
  | {
      kind: "edit";
      task: BoardTask | null; // null = adding new
      title: string;
      description: string;
      minutes: number;
    };

/** Done work counts actual minutes when logged, the estimate otherwise. */
function creditedMinutes(t: BoardTask): number {
  return t.actualMinutes ?? t.estimatedMinutes;
}

function nameOf(members: BoardMember[], enrollmentId: string | null): string {
  return (
    members.find((m) => m.enrollmentId === enrollmentId)?.name ?? "Unknown"
  );
}

function TaskCard({
  task,
  members,
  onOpen,
}: {
  task: BoardTask;
  members: BoardMember[];
  onOpen: (task: BoardTask) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cn(
        "w-full rounded-lg border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:border-foreground/30",
        task.status === "done" && "opacity-80"
      )}
    >
      <p className="flex items-start gap-1.5 text-sm">
        {task.isContract && (
          <FileSignature className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="break-words">{task.title}</span>
      </p>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3" />
        {task.status === "done"
          ? `${formatMinutes(creditedMinutes(task))} logged`
          : formatMinutes(task.estimatedMinutes)}
        {task.status === "done" && (
          <span className="ml-1 flex items-center gap-0.5 text-green-700">
            <Check className="size-3" />
            {nameOf(members, task.assignedEnrollmentId)}
          </span>
        )}
      </p>
    </button>
  );
}

function Column({
  title,
  count,
  children,
  action,
}: {
  title: React.ReactNode;
  count: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-2 rounded-xl bg-muted/40 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} <span className="font-normal">· {count}</span>
        </p>
        {action}
      </div>
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

/**
 * The team's task board: Unassigned → a column per member → Done.
 * Tap a card for its actions (assign, complete with actual minutes, edit,
 * delete) — no drag-and-drop, so it works the same on a phone.
 */
export function TeamBoard({
  courseId,
  teamId,
  teamName,
  members,
  tasks,
  myEnrollmentId,
}: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [busy, setBusy] = useState(false);

  // Teammates' moves show up without a manual reload.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`board-${teamId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "team_tasks",
          filter: `team_id=eq.${teamId}`,
        },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [teamId, router]);

  const columns = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => a.position - b.position);
    return {
      unassigned: sorted.filter((t) => t.status === "unassigned"),
      byMember: new Map(
        members.map((m) => [
          m.enrollmentId,
          sorted.filter(
            (t) =>
              t.status === "assigned" &&
              t.assignedEnrollmentId === m.enrollmentId
          ),
        ])
      ),
      done: sorted
        .filter((t) => t.status === "done")
        .sort((a, b) => b.position - a.position),
    };
  }, [tasks, members]);

  const totals = useMemo(() => {
    const done = new Map<string, number>();
    const queued = new Map<string, number>();
    for (const t of tasks) {
      if (!t.assignedEnrollmentId) continue;
      const map = t.status === "done" ? done : queued;
      map.set(
        t.assignedEnrollmentId,
        (map.get(t.assignedEnrollmentId) ?? 0) + creditedMinutes(t)
      );
    }
    const teamDone = Array.from(done.values()).reduce((a, b) => a + b, 0);
    return { done, queued, teamDone };
  }, [tasks]);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(task: BoardTask, enrollmentId: string | null) {
    const ok = await run(() => assignTask(courseId, task.id, enrollmentId));
    if (ok) setDialog(null);
  }

  async function handleComplete() {
    if (dialog?.kind !== "complete") return;
    const ok = await run(() =>
      completeTask(courseId, dialog.task.id, dialog.minutes)
    );
    if (ok) {
      toast.success("Nice — task done.");
      setDialog(null);
    }
  }

  async function handleSaveEdit() {
    if (dialog?.kind !== "edit") return;
    const payload = {
      courseId,
      title: dialog.title,
      description: dialog.description,
      estimatedMinutes: dialog.minutes,
    };
    const ok = await run(() =>
      dialog.task
        ? updateTeamTask({ ...payload, taskId: dialog.task.id })
        : createTeamTask({ ...payload, teamId })
    );
    if (ok) setDialog(null);
  }

  function memberName(enrollmentId: string | null): string {
    return nameOf(members, enrollmentId);
  }

  const openTask = (task: BoardTask) => setDialog({ kind: "view", task });

  return (
    <div className="grid gap-4">
      <div className="flex gap-3 overflow-x-auto pb-2">
        <Column
          title={
            <span className="inline-flex items-center gap-1">
              <Inbox className="size-3.5" /> Unassigned
            </span>
          }
          count={columns.unassigned.length}
          action={
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              onClick={() =>
                setDialog({
                  kind: "edit",
                  task: null,
                  title: "",
                  description: "",
                  minutes: 30,
                })
              }
              aria-label="Add a task"
            >
              <Plus className="size-4" />
            </Button>
          }
        >
          {columns.unassigned.map((t) => (
            <TaskCard key={t.id} task={t} members={members} onOpen={openTask} />
          ))}
          {columns.unassigned.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              Nothing waiting.
            </p>
          )}
        </Column>

        {members.map((m) => {
          const list = columns.byMember.get(m.enrollmentId) ?? [];
          return (
            <Column
              key={m.enrollmentId}
              title={
                m.enrollmentId === myEnrollmentId ? `${m.name} (you)` : m.name
              }
              count={list.length}
            >
              {list.map((t) => (
                <TaskCard key={t.id} task={t} members={members} onOpen={openTask} />
              ))}
              {list.length === 0 && (
                <p className="px-1 text-xs text-muted-foreground">
                  No tasks yet.
                </p>
              )}
            </Column>
          );
        })}

        <Column title="Done" count={columns.done.length}>
          {columns.done.map((t) => (
            <TaskCard key={t.id} task={t} members={members} onOpen={openTask} />
          ))}
          {columns.done.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              Nothing yet — it&apos;ll fill up.
            </p>
          )}
        </Column>
      </div>

      <div className="rounded-lg border px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {teamName} — contribution so far
        </p>
        <ul className="grid gap-1">
          {members.map((m) => {
            const done = totals.done.get(m.enrollmentId) ?? 0;
            const queued = totals.queued.get(m.enrollmentId) ?? 0;
            const share =
              totals.teamDone > 0
                ? Math.round((done / totals.teamDone) * 100)
                : 0;
            return (
              <li
                key={m.enrollmentId}
                className="flex flex-wrap items-baseline gap-x-3 text-sm"
              >
                <span className="min-w-32 font-medium">
                  {m.enrollmentId === myEnrollmentId ? `${m.name} (you)` : m.name}
                </span>
                <span>
                  {formatMinutes(done)} done
                  {totals.teamDone > 0 && ` · ${share}%`}
                </span>
                {queued > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {formatMinutes(queued)} on their plate
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {dialog?.kind === "view" && (
            <>
              <DialogHeader>
                <DialogTitle className="break-words">
                  {dialog.task.title}
                </DialogTitle>
                <DialogDescription>
                  {dialog.task.status === "done"
                    ? `Done by ${memberName(dialog.task.assignedEnrollmentId)} — ${formatMinutes(creditedMinutes(dialog.task))} logged (estimated ${formatMinutes(dialog.task.estimatedMinutes)}).`
                    : `Estimated ${formatMinutes(dialog.task.estimatedMinutes)}.`}
                </DialogDescription>
              </DialogHeader>
              {dialog.task.description && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {dialog.task.description}
                </p>
              )}
              {dialog.task.isContract ? (
                <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  <FileSignature className="mr-1 inline size-3.5" />
                  This card checks itself off when{" "}
                  {memberName(dialog.task.assignedEnrollmentId)} signs the team
                  contract (on the Projects page).
                </p>
              ) : dialog.task.status === "done" ? (
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void run(() => reopenTask(courseId, dialog.task.id)).then(
                        (ok) => ok && setDialog(null)
                      )
                    }
                    disabled={busy}
                  >
                    <RotateCcw className="mr-1 size-4" /> Reopen
                  </Button>
                </DialogFooter>
              ) : (
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Move to
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {members
                        .filter(
                          (m) =>
                            m.enrollmentId !== dialog.task.assignedEnrollmentId
                        )
                        .map((m) => (
                          <Button
                            key={m.enrollmentId}
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void handleAssign(dialog.task, m.enrollmentId)
                            }
                            disabled={busy}
                          >
                            {m.enrollmentId === myEnrollmentId
                              ? `${m.name} (you)`
                              : m.name}
                          </Button>
                        ))}
                      {dialog.task.status === "assigned" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleAssign(dialog.task, null)}
                          disabled={busy}
                        >
                          <Inbox className="mr-1 size-4" /> Unassigned
                        </Button>
                      )}
                    </div>
                  </div>
                  <DialogFooter className="flex-wrap">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm("Delete this task?")) {
                          void run(() =>
                            deleteTeamTask(courseId, dialog.task.id)
                          ).then((ok) => ok && setDialog(null));
                        }
                      }}
                      disabled={busy}
                      aria-label="Delete task"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setDialog({
                          kind: "edit",
                          task: dialog.task,
                          title: dialog.task.title,
                          description: dialog.task.description ?? "",
                          minutes: dialog.task.estimatedMinutes,
                        })
                      }
                      disabled={busy}
                    >
                      <Pencil className="mr-1 size-4" /> Edit
                    </Button>
                    {dialog.task.status === "assigned" && (
                      <Button
                        onClick={() =>
                          setDialog({
                            kind: "complete",
                            task: dialog.task,
                            minutes: dialog.task.estimatedMinutes,
                          })
                        }
                        disabled={busy}
                      >
                        <Check className="mr-1 size-4" /> Mark done
                      </Button>
                    )}
                  </DialogFooter>
                </div>
              )}
            </>
          )}

          {dialog?.kind === "complete" && (
            <>
              <DialogHeader>
                <DialogTitle>How long did it actually take?</DialogTitle>
                <DialogDescription>
                  Honest numbers keep the contribution split fair — this is
                  what counts, not the estimate.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={6000}
                  value={dialog.minutes}
                  onChange={(e) =>
                    setDialog((d) =>
                      d?.kind === "complete"
                        ? {
                            ...d,
                            minutes: Math.max(
                              1,
                              Math.round(Number(e.target.value) || 1)
                            ),
                          }
                        : d
                    )
                  }
                  className="max-w-28"
                  autoFocus
                />
                <span className="text-sm text-muted-foreground">
                  minutes (estimated{" "}
                  {formatMinutes(dialog.task.estimatedMinutes)})
                </span>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialog({ kind: "view", task: dialog.task })}
                >
                  Back
                </Button>
                <Button onClick={() => void handleComplete()} disabled={busy}>
                  {busy ? "Saving…" : "Done"}
                </Button>
              </DialogFooter>
            </>
          )}

          {dialog?.kind === "edit" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {dialog.task ? "Edit task" : "Add a task"}
                </DialogTitle>
                <DialogDescription>
                  Your team owns this board — split, reword, or re-estimate
                  tasks however works for you.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="tb-title">
                    Task
                  </label>
                  <Input
                    id="tb-title"
                    value={dialog.title}
                    onChange={(e) =>
                      setDialog((d) =>
                        d?.kind === "edit" ? { ...d, title: e.target.value } : d
                      )
                    }
                    placeholder="Design the survey"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="tb-desc">
                    Details{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </label>
                  <textarea
                    id="tb-desc"
                    value={dialog.description}
                    onChange={(e) =>
                      setDialog((d) =>
                        d?.kind === "edit"
                          ? { ...d, description: e.target.value }
                          : d
                      )
                    }
                    className="min-h-16 w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="tb-minutes">
                    Estimated minutes
                  </label>
                  <Input
                    id="tb-minutes"
                    type="number"
                    min={1}
                    max={6000}
                    value={dialog.minutes}
                    onChange={(e) =>
                      setDialog((d) =>
                        d?.kind === "edit"
                          ? {
                              ...d,
                              minutes: Math.max(
                                1,
                                Math.round(Number(e.target.value) || 1)
                              ),
                            }
                          : d
                      )
                    }
                    className="max-w-28"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void handleSaveEdit()} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
