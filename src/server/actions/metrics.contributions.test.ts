import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), userId: "professor" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: mocks.userId } } }) }, from: mocks.from,
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ isConfigured: { supabaseAdmin: false } }));
vi.mock("@/lib/coursedirectory", () => ({ getCourseDirectory: vi.fn() }));
import { getCourseProjectStats, getStudentWorkReadiness } from "./metrics";

it("shows faculty task evidence only for legacy teams in a mixed-mode course", async () => {
  const rows: Record<string, Record<string, unknown>[]> = {
    courses: [{ id: "course", professor_id: "professor" }],
    projects: [{ id: "legacy", course_id: "course", title: "Task project", mode: "tasks" },
      { id: "new", course_id: "course", title: "Contribution project", mode: "contribution" }],
    project_teams: [{ id: "legacy-team", project_id: "legacy", course_id: "course", name: "Legacy team" },
      { id: "new-team", project_id: "new", course_id: "course", name: "Contribution team" }],
    project_team_members: [{ team_id: "legacy-team", project_id: "legacy", enrollment_id: "student", role: "member" },
      { team_id: "new-team", project_id: "new", enrollment_id: "other", role: "member" }],
    team_tasks: [{ id: "task", team_id: "legacy-team", project_id: "legacy", title: "Research", status: "done",
      estimated_minutes: 30, actual_minutes: 45, assigned_enrollment_id: "student", assigned_by_enrollment_id: null }],
    task_flags: [], team_contract_signatures: [],
  };
  installRows(rows);
  const result = await getCourseProjectStats("course");
  expect(result).toHaveLength(1);
  expect(result![0].projectId).toBe("legacy");
  expect(result![0].teams[0].teamDoneMinutes).toBe(45);
  expect(result![0].teams[0].members[0].stats.doneTasks).toBe(1);
});

function installRows(rows: Record<string, Record<string, unknown>[]>) {
  mocks.from.mockImplementation((table: string) => {
    let result = rows[table] ?? [];
    const query = {
      select: () => query, order: () => query, is: () => query, or: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { result = result.filter(r => r[key] === value); return query; },
      in: (key: string, values: unknown[]) => { result = result.filter(r => values.includes(r[key])); return query; },
      single: async () => ({ data: result[0] ?? null }),
      maybeSingle: async () => ({ data: result[0] ?? null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result }).then(resolve),
    };
    return query;
  });
}

it("retains signed contribution contracts in student dependability without task scores", async () => {
  mocks.userId = "profile";
  installRows({
    enrollments: [{ id: "student", profile_id: "profile", course_id: "course", status: "active" }],
    project_team_members: [{ team_id: "contribution-team", enrollment_id: "student", role: "lead", project_teams: { projects: { mode: "contribution" } } }],
    project_teams: [{ id: "contribution-team", project_id: "project", name: "Team", projects: { title: "Project", mode: "contribution" } }],
    team_contract_signatures: [{ team_id: "contribution-team", enrollment_id: "student" }],
  });
  const result = await getStudentWorkReadiness("course");
  const dependability = result!.competencies.find(c => c.key === "dependability")!;
  expect(dependability.score).toBe(30);
  expect(dependability.evidence).toContain("Signed every team contract you were part of");
  expect(result!.competencies.some(c => c.key === "work-ethic")).toBe(false);
  expect(result!.competencies.find(c => c.key === "leadership")!.score).toBe(30);
  mocks.userId = "professor";
});
