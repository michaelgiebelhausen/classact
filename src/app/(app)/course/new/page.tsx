"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createCourse } from "@/server/actions/courses";
import { startCheckout } from "@/server/actions/billing";

export default function NewCoursePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await createCourse({ name, term });
    if (result.ok && result.data) {
      toast.success(`Course created — join code ${result.data.joinCode}`);
      router.push(`/course/${result.data.id}/setup`);
    } else if (!result.ok && result.error === "billing_required") {
      // $4.99/mo keeps the lights on — AI runs on your own OpenRouter credits.
      toast.message("Running a course is $4.99/month — taking you to checkout.");
      const checkout = await startCheckout();
      if (checkout.ok && checkout.data) {
        window.location.href = checkout.data.url;
      } else {
        setSaving(false);
        toast.error(checkout.ok ? "Checkout unavailable." : checkout.error);
      }
    } else {
      setSaving(false);
      toast.error(result.ok ? "Something went wrong." : result.error);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Create a course</CardTitle>
          <CardDescription>
            Name it the way it appears on your syllabus — students will
            recognize it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Course name</Label>
              <Input
                id="name"
                required
                placeholder="MKT 4310 — Marketing Research"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="term">Term (optional)</Label>
              <Input
                id="term"
                placeholder="Fall 2026"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create course"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
