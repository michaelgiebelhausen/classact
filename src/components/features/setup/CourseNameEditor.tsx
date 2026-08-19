"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameCourse } from "@/server/actions/courses";

/**
 * The course title on the setup page, editable in place. A course gets named
 * before the professor knows what the section will really be called; renaming
 * it later shouldn't mean rebuilding the course.
 */
export function CourseNameEditor({
  courseId,
  name,
}: {
  courseId: string;
  name: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

  function cancel() {
    setDraft(name);
    setEditing(false);
  }

  async function save() {
    const next = draft.trim();
    if (next === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await renameCourse(courseId, next);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDraft(result.data?.name ?? next);
    setEditing(false);
    toast.success("Course renamed.");
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="group flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          title="Rename course"
          aria-label="Rename course"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        autoFocus
        aria-label="Course name"
        className="h-10 max-w-sm text-lg font-semibold"
        value={draft}
        maxLength={120}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") cancel();
        }}
      />
      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}>
        Cancel
      </Button>
    </div>
  );
}
