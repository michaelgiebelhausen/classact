import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();

  if (profile.role === "professor") {
    const { data: courses } = await supabase
      .from("courses")
      .select("id, name, term, join_code")
      .eq("professor_id", profile.id)
      .order("created_at", { ascending: false });

    return (
      <div className="grid gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">My courses</h1>
          <Button asChild>
            <Link href="/course/new">Create course</Link>
          </Button>
        </div>
        {!courses || courses.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No courses yet. Create one and you&apos;ll have a room set up in
              about five minutes.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {courses.map((c) => (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{c.name}</CardTitle>
                  <CardDescription>
                    {c.term ?? "No term set"} · Join code{" "}
                    <span className="font-mono">{c.join_code}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button asChild size="sm">
                    <Link href={`/course/${c.id}`}>Open</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/course/${c.id}/setup`}>Setup</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Student view
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, status, course_id, courses(id, name, term)")
    .eq("profile_id", profile.id);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">My classes</h1>
        <Button asChild variant="outline">
          <Link href="/join">Join a class</Link>
        </Button>
      </div>
      {!enrollments || enrollments.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            You&apos;re not in any classes yet. Got a join code from your
            professor? Use it above.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {enrollments.map((e) => {
            const course = e.courses as unknown as {
              id: string;
              name: string;
              term: string | null;
            } | null;
            if (!course) return null;
            return (
              <Card key={e.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{course.name}</CardTitle>
                  <CardDescription>
                    {course.term ?? ""}
                    {e.status === "invited" && (
                      <Badge variant="secondary" className="ml-2">
                        Pending approval
                      </Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild size="sm">
                    <Link href={`/course/${course.id}`}>Open</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
