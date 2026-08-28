"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { isFounder } from "@/server/founder";
import {
  DRY_RUN_BRIEF,
  DRY_RUN_FIXTURES,
} from "@/server/gradingdev-fixtures";
import type { ActionResult } from "@/server/actions/auth";

/**
 * The grading dry run — founder-only.
 *
 * Tasty Grading shipped without ever having run end to end against a live
 * model: every phase was proved by unit tests on the math and mocks on the
 * shape. This seeds a throwaway assignment with synthetic submissions and
 * lets the REAL pipeline grade it, so the first assignment that runs for
 * credit is not also the first one that has ever run.
 *
 * It spends real API money (a few dozen cents), which is exactly why it is
 * gated: /dev/roommap is a harmless gallery, this is not.
 */

const ASSIGNMENT_BUCKET = "assignment-docs";
const DRY_RUN_PREFIX = "DRY RUN —";

interface DryRunState {
  dryRunPaths?: string[];
}

async function requireFounder(): Promise<string | null> {
  if (!(await isFounder())) {
    return "Founder only — this one spends real API credit.";
  }
  if (!isConfigured.supabaseAdmin) {
    return "Server isn't configured (service role missing).";
  }
  return null;
}

/**
 * Build a throwaway assignment whose deadline has already passed, so the
 * analysis machine can be cranked immediately.
 *
 * Written through the admin client on purpose: createAssignment refuses a
 * deadline in the past, which is the correct rule for a real assignment and
 * precisely what a dry run needs to skip.
 */
export async function seedGradingDryRun(
  courseId: string,
  mode: "tasty" | "ai_only"
): Promise<ActionResult<{ assignmentId: string; students: number }>> {
  const refusal = await requireFounder();
  if (refusal) return { ok: false, error: refusal };

  const admin = createAdminClient();
  const { data: enrollments } = await admin
    .from("enrollments")
    .select("id, roster_name")
    .eq("course_id", courseId)
    .eq("status", "active")
    .order("roster_name")
    .limit(DRY_RUN_FIXTURES.length);
  if (!enrollments || enrollments.length < 2) {
    return {
      ok: false,
      error: "That course needs at least two active students to rank anything.",
    };
  }

  const now = Date.now();
  const { data: assignment, error: createError } = await admin
    .from("assignments")
    .insert({
      course_id: courseId,
      title: `${DRY_RUN_PREFIX} campus coffee shop memo`,
      instructions: DRY_RUN_BRIEF,
      points: 100,
      // Already closed: submissions are seeded, not collected.
      deadline: new Date(now - 60_000).toISOString(),
      peer_close_at: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
      settings: {
        ...(mode === "ai_only"
          ? { gradingMode: "ai_only" }
          : { tasteRequirement: "optional" }),
        bands: [
          { label: "A", value: 90 },
          { label: "B", value: 80 },
          { label: "C", value: 70 },
        ],
        scoreMode: "stepped",
      },
      state: "open",
    })
    .select("id")
    .single();
  if (createError || !assignment) {
    return { ok: false, error: "Couldn't create the dry-run assignment." };
  }

  const paths: string[] = [];
  const professorTaste =
    mode === "ai_only"
      ? "Grade the memo on whether it takes a clear position, supports it with at least one concrete number, and states honestly what would make the writer wrong. A memo that cannot be wrong is a brochure, not an argument."
      : "I care most about whether the writer commits to a recommendation and then earns it. Concrete numbers beat adjectives, and the paragraph I look for is the one where they say what would change their mind.";
  await admin.from("taste_files").insert({
    assignment_id: assignment.id,
    course_id: courseId,
    enrollment_id: null,
    body: professorTaste,
    is_default_untouched: false,
    first_edit_at: new Date().toISOString(),
    last_edit_at: new Date().toISOString(),
  });

  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];
    const fixture = DRY_RUN_FIXTURES[i % DRY_RUN_FIXTURES.length];
    // Scoped by assignment: two dry runs living at once wrote identical
    // paths, so tearing either one down took the other's files with it.
    const path = `${courseId}/sub/${enrollment.id}/dryrun-${assignment.id}-${i}.md`;
    const { error: uploadError } = await admin.storage
      .from(ASSIGNMENT_BUCKET)
      .upload(path, new Blob([fixture.body], { type: "text/markdown" }), {
        contentType: "text/markdown",
        upsert: true,
      });
    if (uploadError) continue;
    paths.push(path);

    await admin.from("submissions").insert({
      assignment_id: assignment.id,
      course_id: courseId,
      enrollment_id: enrollment.id,
      storage_path: path,
      note: "",
      submitted_at: new Date(now - 120_000).toISOString(),
      last_edit_at: new Date(now - 120_000).toISOString(),
    });

    if (mode === "tasty") {
      await admin.from("taste_files").insert({
        assignment_id: assignment.id,
        course_id: courseId,
        enrollment_id: enrollment.id,
        body: fixture.taste,
        is_default_untouched: false,
        first_edit_at: new Date(now - 180_000).toISOString(),
        last_edit_at: new Date(now - 180_000).toISOString(),
      });
    }
  }

  // Remembered so teardown can remove exactly what this created.
  await admin
    .from("assignments")
    .update({ analysis: { dryRunPaths: paths } })
    .eq("id", assignment.id);

  revalidatePath(`/course/${courseId}/assignments`);
  return {
    ok: true,
    data: { assignmentId: assignment.id, students: paths.length },
  };
}

/** Remove a dry run and everything it created. */
export async function teardownGradingDryRun(
  assignmentId: string
): Promise<ActionResult> {
  const refusal = await requireFounder();
  if (refusal) return { ok: false, error: refusal };

  const admin = createAdminClient();
  const { data: assignment } = await admin
    .from("assignments")
    .select("id, course_id, title, analysis")
    .eq("id", assignmentId)
    .single();
  if (!assignment) return { ok: false, error: "Already gone." };
  // Guard against a fat-fingered id taking out a real assignment.
  if (!assignment.title.startsWith(DRY_RUN_PREFIX)) {
    return { ok: false, error: "That isn't a dry run — refusing to delete it." };
  }

  const paths = (assignment.analysis as DryRunState).dryRunPaths ?? [];
  if (paths.length > 0) {
    await admin.storage.from(ASSIGNMENT_BUCKET).remove(paths);
  }
  // 0013's cascades take the taste files, submissions, themes, scores,
  // comparisons and rankings with it.
  const { error } = await admin.from("assignments").delete().eq("id", assignmentId);
  if (error) return { ok: false, error: "Couldn't remove the dry run." };

  revalidatePath(`/course/${assignment.course_id}/assignments`);
  return { ok: true };
}

/** Courses the founder can run a dry run against, plus any live dry runs. */
export async function listDryRuns(): Promise<
  ActionResult<{
    courses: Array<{ id: string; title: string }>;
    runs: Array<{ id: string; courseId: string; title: string; state: string }>;
  }>
> {
  const refusal = await requireFounder();
  if (refusal) return { ok: false, error: refusal };

  const admin = createAdminClient();
  const [{ data: courses }, { data: runs }] = await Promise.all([
    admin.from("courses").select("id, name").order("name"),
    admin
      .from("assignments")
      .select("id, course_id, title, state")
      .like("title", `${DRY_RUN_PREFIX}%`),
  ]);
  return {
    ok: true,
    data: {
      courses: (courses ?? []).map((c) => ({ id: c.id, title: c.name })),
      runs: (runs ?? []).map((r) => ({
        id: r.id,
        courseId: r.course_id,
        title: r.title,
        state: r.state,
      })),
    },
  };
}
