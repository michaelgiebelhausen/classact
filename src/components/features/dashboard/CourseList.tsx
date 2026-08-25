"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyCourseButton } from "@/components/features/CopyCourseButton";
import { reorderCourses } from "@/server/actions/courses";

export interface CourseListItem {
  id: string;
  name: string;
  term: string | null;
  joinCode: string;
  /** "Mon, Wed, Fri · 9:30 AM–10:20 AM", or "" when setup has no schedule. */
  scheduleLabel: string;
}

/**
 * The professor's courses as one drag-orderable stack (same armed-grip
 * pattern as DeckManager). The schedule line comes from Setup, not from the
 * course name — professors often write a time into the name, and showing
 * both is what lets them catch the two disagreeing.
 */
export function CourseList({ courses }: { courses: CourseListItem[] }) {
  const router = useRouter();
  const [serverCourses, setServerCourses] = useState(courses);
  const [order, setOrder] = useState(courses);
  // Adopt fresh server data (a rename, a new course) unless mid-drag.
  if (serverCourses !== courses) {
    setServerCourses(courses);
    setOrder(courses);
  }
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragArmed, setDragArmed] = useState(false);

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    void reorderCourses(next.map((c) => c.id)).then((result) => {
      if (!result.ok) {
        toast.error(result.error);
        setOrder(courses); // put it back where the server still has it
      } else {
        router.refresh();
      }
    });
  }

  return (
    <ul className="grid gap-3">
      {order.map((c, index) => (
        <li
          key={c.id}
          draggable={dragArmed}
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => {
            if (dragIndex !== null && dragIndex !== index) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex !== null) move(dragIndex, index);
            setDragIndex(null);
            setDragArmed(false);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setDragArmed(false);
          }}
          className={[
            "rounded-lg border bg-card p-4 transition-colors",
            dragIndex === index ? "opacity-50" : "",
            dragIndex !== null && dragIndex !== index
              ? "border-dashed hover:border-primary"
              : "",
          ].join(" ")}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label={`Reorder ${c.name}. Use arrow keys to move it.`}
                onMouseDown={() => setDragArmed(true)}
                onMouseUp={() => setDragArmed(false)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    move(index, index - 1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    move(index, index + 1);
                  }
                }}
                className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate font-medium">{c.name}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  {c.scheduleLabel ? (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="size-3.5" />
                      {c.scheduleLabel}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="size-3.5" />
                      No schedule set
                    </span>
                  )}
                  <span>
                    {c.term ?? "No term set"} · Join code{" "}
                    <span className="font-mono">{c.joinCode}</span>
                  </span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/course/${c.id}`}>Open</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/course/${c.id}/setup`}>Setup</Link>
              </Button>
              <CopyCourseButton courseId={c.id} courseName={c.name} term={c.term} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
