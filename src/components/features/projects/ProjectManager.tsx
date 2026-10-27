"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  FileText,
  FolderKanban,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PROJECT_BUCKET } from "@/lib/storage";
import {
  createProject,
  deleteProject,
  setProjectOpen,
  updateProject,
} from "@/server/actions/projects";
import {
  ProjectTasks,
  type TaskItem,
} from "@/components/features/projects/ProjectTasks";
import { capture } from "@/lib/analytics";

const MAX_PDF_BYTES = 50 * 1024 * 1024; // Supabase default object limit

export interface ProjectTeamSummary {
  id: string;
  name: string;
  memberCount: number;
  signedCount: number;
  flagCount: number;
}

export interface ProjectListItem {
  mode: "tasks" | "contribution";
  brief: string;
  id: string;
  title: string;
  pageCount: number | null;
  dueDate: string | null;
  targetTeamSize: number | null;
  contractText: string;
  status: "draft" | "open";
  tasks: TaskItem[];
  teams: ProjectTeamSummary[];
}

interface Props {
  courseId: string;
  projects: ProjectListItem[];
}

interface ProjectSettings {
  brief: string;
  id: string;
  title: string;
  dueDate: string;
  targetTeamSize: string; // keep as text in the form; "" = not set
  contractText: string;
}

/** Count pages locally so the project row stores the real page count. */
async function countPdfPages(file: File): Promise<number | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const doc = await loadingTask.promise;
    const pages = doc.numPages;
    void loadingTask.destroy();
    return pages;
  } catch {
    return null;
  }
}

function formatDueDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProjectManager({ courseId, projects }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<"tasks" | "contribution">("contribution");
  const [newTitle, setNewTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [createError, setCreateError] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("Save the assignment as a PDF first (File → Export → PDF).");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("That PDF is over 50MB — compress it and try again.");
      return;
    }
    setUploading(true);
    try {
      const path = `${courseId}/${crypto.randomUUID()}.pdf`;
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(PROJECT_BUCKET)
        .upload(path, file, { contentType: "application/pdf" });
      if (uploadError) {
        toast.error("Upload failed — check your connection and try again.");
        return;
      }
      const pageCount = await countPdfPages(file);
      const title = file.name.replace(/\.pdf$/i, "");
      const size = teamSize.trim() ? Number(teamSize) : undefined;
      const result = await createProject({
        courseId,
        title,
        storagePath: path,
        mode: "tasks",
        pageCount: pageCount ?? undefined,
        dueDate: dueDate || undefined,
        targetTeamSize: size,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      capture("project_uploaded", { pageCount });
      toast.success(
        `"${title}" is in. Hit Generate tasks to break it into a to-do list.`
      );
      setDueDate("");
      setTeamSize("");
      router.refresh();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCreateContribution() {
    setUploading(true); setCreateError("");
    try {
      const result = await createProject({ courseId, title: newTitle, brief, mode: "contribution", dueDate: dueDate || undefined, targetTeamSize: teamSize.trim() ? Number(teamSize) : undefined });
      if (!result.ok) { setCreateError(result.error); return; }
      setNewTitle(""); setBrief(""); setDueDate(""); setTeamSize(""); router.refresh();
    } catch { setCreateError("Connection failed. Try again."); }
    finally { setUploading(false); }
  }

  async function handleToggleOpen(project: ProjectListItem) {
    const opening = project.status !== "open";
    setBusyProject(project.id);
    const result = await setProjectOpen(courseId, project.id, opening);
    setBusyProject(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      opening
        ? "Project is open — students can now see it and form teams."
        : "Project pulled back to draft."
    );
    router.refresh();
  }

  async function handleDelete(project: ProjectListItem) {
    if (
      !window.confirm(
        `Delete "${project.title}" and its task list? This can't be undone.`
      )
    ) {
      return;
    }
    setBusyProject(project.id);
    const result = await deleteProject(courseId, project.id);
    setBusyProject(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Project deleted.");
    router.refresh();
  }

  async function handleSaveSettings() {
    if (!settings) return;
    const size = settings.targetTeamSize.trim()
      ? Number(settings.targetTeamSize)
      : null;
    setSavingSettings(true);
    try {
      const result = await updateProject({
        courseId,
        projectId: settings.id,
        title: settings.title,
        dueDate: settings.dueDate || undefined,
        targetTeamSize: size,
        contractText: settings.contractText,
        brief: settings.brief,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Project updated.");
      setSettings(null);
      router.refresh();
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
          <CardDescription>
            Start with a title. Teams agree on work shares and privately check in on contributions. You can also create a legacy task board from a PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="grid gap-1.5 text-sm">Project approach
            <select value={mode} onChange={e => setMode(e.target.value as "tasks" | "contribution")} className="min-h-11 rounded-lg border bg-background p-2">
              <option value="contribution">Work shares and private check-ins</option><option value="tasks">Legacy task board (PDF)</option>
            </select>
          </label>
          {mode === "contribution" && <>
            <label className="grid gap-1.5 text-sm">Project title<Input maxLength={200} value={newTitle} onChange={e => setNewTitle(e.target.value)} /></label>
            <label className="grid gap-1.5 text-sm">Assignment brief (optional)<textarea maxLength={20000} value={brief} onChange={e => setBrief(e.target.value)} className="min-h-24 rounded-lg border bg-background p-3 focus-visible:outline-ring" /></label>
          </>}
          {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="project-due"
              >
                Due date (optional)
              </label>
              <Input
                id="project-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="max-w-44"
              />
            </div>
            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="project-teamsize"
              >
                Team size (optional)
              </label>
              <Input
                id="project-teamsize"
                type="number"
                min={1}
                max={20}
                placeholder="4"
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
                className="max-w-24"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            {mode === "tasks" ? <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <FileText className="mr-2 size-4" />
              {uploading ? "Working…" : "Upload assignment PDF"}
            </Button> : <Button disabled={uploading || !newTitle.trim()} onClick={() => void handleCreateContribution()}>{uploading ? "Creating…" : "Create project"}</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your projects</CardTitle>
          <CardDescription>
            Open a project so students can form teams. Select a team to review its agreement and private check-ins. Drafts are invisible to students.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects yet. Create your first project above.
            </p>
          ) : (
            <ul className="grid gap-2">
              {projects.map((project) => (
                <li key={project.id} className="rounded-lg border px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <FolderKanban className="size-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {project.title}
                          <span
                            className={
                              project.status === "open"
                                ? "ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800"
                                : "ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                            }
                          >
                            {project.status === "open" ? "Open" : "Draft"}
                          </span>
                        </p>
                        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          {project.dueDate && (
                            <span className="flex items-center gap-1">
                              <CalendarDays className="size-3" />
                              Due {formatDueDate(project.dueDate)}
                            </span>
                          )}
                          {project.targetTeamSize && (
                            <span className="flex items-center gap-1">
                              <Users className="size-3" />
                              Teams of ~{project.targetTeamSize}
                            </span>
                          )}
                          {project.pageCount && (
                            <span>{project.pageCount} pages</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={
                          project.status === "open" ? "outline" : "default"
                        }
                        onClick={() => void handleToggleOpen(project)}
                        disabled={busyProject === project.id}
                      >
                        {project.status === "open"
                          ? "Back to draft"
                          : "Open to students"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setSettings({
                            id: project.id,
                            brief: project.brief,
                            title: project.title,
                            dueDate: project.dueDate ?? "",
                            targetTeamSize: project.targetTeamSize
                              ? String(project.targetTeamSize)
                              : "",
                            contractText: project.contractText,
                          })
                        }
                        disabled={busyProject === project.id}
                        aria-label={`Edit ${project.title} settings`}
                      >
                        <Settings2 className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleDelete(project)}
                        disabled={busyProject === project.id}
                        aria-label={`Delete ${project.title}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {project.mode === "tasks" && <ProjectTasks
                    courseId={courseId}
                    projectId={project.id}
                    tasks={project.tasks}
                  />}
                  {project.teams.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
                      <Users className="size-3 text-muted-foreground" />
                      {project.teams.map((t) => (
                        <Link
                          key={t.id}
                          href={`/course/${courseId}/projects/${project.id}?team=${t.id}`}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {t.name} ({t.memberCount} member
                          {t.memberCount === 1 ? "" : "s"} · {t.signedCount}{" "}
                          signed)
                          {t.flagCount > 0 && (
                            <span className="ml-1 font-semibold text-red-600">
                              · {t.flagCount} flag
                              {t.flagCount === 1 ? "" : "s"}
                            </span>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={settings !== null}
        onOpenChange={(open) => {
          if (!open) setSettings(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Project settings</DialogTitle>
            <DialogDescription>
              The team contract below is the default every team starts from —
              teams can tailor their copy.
            </DialogDescription>
          </DialogHeader>
          {settings && (
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm">Assignment brief (optional)<textarea value={settings.brief} maxLength={20000} onChange={e => setSettings(s => s ? { ...s, brief: e.target.value } : s)} className="min-h-24 rounded-lg border bg-background p-3 focus-visible:outline-ring" /></label>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="ps-title">
                  Title
                </label>
                <Input
                  id="ps-title"
                  value={settings.title}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, title: e.target.value } : s
                    )
                  }
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="ps-due">
                    Due date
                  </label>
                  <Input
                    id="ps-due"
                    type="date"
                    value={settings.dueDate}
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, dueDate: e.target.value } : s
                      )
                    }
                    className="max-w-44"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="ps-size">
                    Target team size
                  </label>
                  <Input
                    id="ps-size"
                    type="number"
                    min={1}
                    max={20}
                    value={settings.targetTeamSize}
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, targetTeamSize: e.target.value } : s
                      )
                    }
                    className="max-w-24"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="ps-contract">
                  Default team contract
                </label>
                <textarea
                  id="ps-contract"
                  value={settings.contractText}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, contractText: e.target.value } : s
                    )
                  }
                  className="min-h-48 w-full resize-y rounded-lg border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettings(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSaveSettings()}
              disabled={savingSettings}
            >
              {savingSettings ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
