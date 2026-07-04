"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
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
  createProjectTask,
  deleteProjectTask,
  generateTasksFromPdf,
  updateProjectTask,
} from "@/server/actions/projects";
import { formatMinutes } from "@/lib/projects";
import { capture } from "@/lib/analytics";

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  estimatedMinutes: number;
  source: "ai" | "professor";
}

interface Props {
  courseId: string;
  projectId: string;
  tasks: TaskItem[];
}

interface DraftTask {
  id: string | null; // null = adding new
  title: string;
  description: string;
  estimatedMinutes: number;
}

/**
 * The task template under a project in "Your projects": collapsible list of
 * AI-drafted + professor-written tasks with edit / delete / add. This list is
 * the starting to-do board every team copies when it forms — teams own their
 * copies from there, so the professor only needs it roughly right.
 */
export function ProjectTasks({ courseId, projectId, tasks }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(tasks.length > 0);
  const [generating, setGenerating] = useState(false);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTask | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  const totalMinutes = tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const result = await generateTasksFromPdf(courseId, projectId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const count = result.data?.count ?? 0;
      capture("project_tasks_generated", { count });
      toast.success(
        `Drafted ${count} tasks from the assignment — tune any time estimates that look off.`
      );
      setExpanded(true);
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(task: TaskItem) {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) {
      return;
    }
    setBusyTask(task.id);
    const result = await deleteProjectTask(courseId, task.id);
    setBusyTask(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Task deleted.");
    router.refresh();
  }

  async function handleSaveDraft() {
    if (!draft) return;
    setSavingDraft(true);
    try {
      const payload = {
        courseId,
        title: draft.title,
        description: draft.description,
        estimatedMinutes: draft.estimatedMinutes,
      };
      const result = draft.id
        ? await updateProjectTask({ ...payload, taskId: draft.id })
        : await createProjectTask({ ...payload, projectId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(draft.id ? "Task updated." : "Task added.");
      setDraft(null);
      router.refresh();
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <div className="mt-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          {tasks.length === 0
            ? "Task list"
            : `${tasks.length} task${tasks.length === 1 ? "" : "s"} · ~${formatMinutes(totalMinutes)} total`}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleGenerate()}
            disabled={generating}
          >
            <Sparkles className="mr-1 size-4" />
            {generating ? "Reading the assignment…" : "Generate tasks"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDraft({
                id: null,
                title: "",
                description: "",
                estimatedMinutes: 30,
              })
            }
            aria-label="Add a task"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <ul className="mt-2 grid gap-1.5">
          {tasks.length === 0 && (
            <li className="text-xs text-muted-foreground">
              No tasks yet — hit Generate to draft a starting list from the
              assignment PDF, or add your own with +. Teams get a copy of this
              list and take it from there.
            </li>
          )}
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-2.5 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{t.title}</p>
                {t.description && (
                  <p className="break-words text-xs text-muted-foreground">
                    {t.description}
                  </p>
                )}
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" />
                  {formatMinutes(t.estimatedMinutes)}
                  {t.source === "ai" && " · AI draft"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft({
                      id: t.id,
                      title: t.title,
                      description: t.description ?? "",
                      estimatedMinutes: t.estimatedMinutes,
                    })
                  }
                  disabled={busyTask === t.id}
                  aria-label="Edit task"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleDelete(t)}
                  disabled={busyTask === t.id}
                  aria-label="Delete task"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit task" : "Add a task"}</DialogTitle>
            <DialogDescription>
              A task one student could pick up and finish. The time estimate is
              the task&apos;s weight in contribution scoring — rough is fine.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="task-title">
                  Task
                </label>
                <Input
                  id="task-title"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, title: e.target.value } : d))
                  }
                  placeholder="Draft the literature review"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="task-desc">
                  What does done look like?{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <textarea
                  id="task-desc"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, description: e.target.value } : d
                    )
                  }
                  className="min-h-20 w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="task-minutes">
                  Estimated minutes
                </label>
                <Input
                  id="task-minutes"
                  type="number"
                  min={1}
                  max={6000}
                  value={draft.estimatedMinutes}
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            estimatedMinutes: Math.max(
                              1,
                              Math.round(Number(e.target.value) || 1)
                            ),
                          }
                        : d
                    )
                  }
                  className="max-w-28"
                />
                <p className="text-xs text-muted-foreground">
                  Focused working time for one student. Students log actual
                  minutes when they finish, so estimates self-correct.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSaveDraft()}
              disabled={savingDraft}
            >
              {savingDraft ? "Saving…" : "Save task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
