import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/aicrypto";
import { env, isConfigured } from "@/lib/env";

/**
 * Per-professor Canvas credentials (0017). Resolution order: the professor's
 * own vaulted token, then the env pair as a founder-era fallback. Decrypted
 * tokens live only inside server code — never in action return values, logs,
 * or the client.
 */

export interface CanvasCreds {
  baseUrl: string;
  token: string;
  source: "professor" | "env";
}

export async function resolveCanvasCreds(
  profileId: string
): Promise<CanvasCreds | null> {
  if (isConfigured.supabaseAdmin && isConfigured.keyVault) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("professor_canvas")
      .select("base_url, token_ciphertext")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (data) {
      try {
        return {
          baseUrl: data.base_url,
          token: decryptSecret(data.token_ciphertext),
          source: "professor",
        };
      } catch {
        // Wrong/rotated APP_ENCRYPTION_KEY — fall through to env.
      }
    }
  }
  if (isConfigured.canvas) {
    return { baseUrl: env.canvasBaseUrl!, token: env.canvasToken!, source: "env" };
  }
  return null;
}

/** Verify a token against a Canvas instance; returns the account's name. */
export async function validateCanvasToken(
  baseUrl: string,
  token: string
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/users/self`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: "Canvas rejected that token — copy it again (it's only shown once when generated).",
      };
    }
    if (!res.ok) {
      return { ok: false, error: `Canvas answered ${res.status} — is the web address right?` };
    }
    const user = (await res.json()) as { name?: string };
    return { ok: true, name: user.name?.trim() || "your Canvas account" };
  } catch {
    return {
      ok: false,
      error: "Couldn't reach that Canvas address — check the web address and try again.",
    };
  }
}

export interface CanvasTeacherCourse {
  id: string;
  name: string;
  courseCode: string | null;
  term: string | null;
}

/** Parse the `next` URL from a Canvas Link header for pagination. */
function nextLink(header: string | null, base: string): string | null {
  if (!header) return null;
  let baseOrigin: string;
  try {
    baseOrigin = new URL(base).origin;
  } catch {
    return null;
  }
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (!m) continue;
    // Only follow Canvas's own pagination — never an origin a hostile host
    // could inject to point our token-bearing fetch at an internal address.
    try {
      if (new URL(m[1]).origin === baseOrigin) return m[1];
    } catch {
      // ignore an unparseable Link target
    }
    return null;
  }
  return null;
}

export interface CanvasSection {
  id: string;
  name: string;
  totalStudents: number | null;
}

/**
 * A Canvas course's sections. Cross-listed courses (several meeting times
 * merged into one Canvas shell) come back as multiple sections; the sync UI
 * lets the professor pick which ones belong in this ClassAct course.
 */
export async function fetchCourseSections(
  creds: CanvasCreds,
  canvasCourseId: string
): Promise<CanvasSection[]> {
  let url: string | null =
    `${creds.baseUrl}/api/v1/courses/${encodeURIComponent(canvasCourseId)}/sections?include[]=total_students&per_page=100`;
  const sections: CanvasSection[] = [];
  let pages = 0;
  while (url && pages < 5) {
    pages++;
    const res: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) {
      throw new Error("Canvas course not found — double-check the course ID.");
    }
    if (!res.ok) {
      throw new Error(`Canvas returned ${res.status} while listing sections.`);
    }
    const batch = (await res.json()) as Array<{
      id: number;
      name?: string | null;
      total_students?: number | null;
    }>;
    for (const s of batch) {
      if (!s?.id) continue;
      sections.push({
        id: String(s.id),
        name: s.name?.trim() || `Section ${s.id}`,
        totalStudents: s.total_students ?? null,
      });
    }
    url = nextLink(res.headers.get("link"), creds.baseUrl);
  }
  return sections;
}

/** Courses this token's owner teaches — for the "pick your course" list. */
export async function fetchTeacherCourses(
  creds: CanvasCreds
): Promise<CanvasTeacherCourse[]> {
  let url: string | null =
    `${creds.baseUrl}/api/v1/courses?enrollment_type=teacher&enrollment_state=active&include[]=term&per_page=100`;
  const courses: CanvasTeacherCourse[] = [];
  let pages = 0;
  while (url && pages < 5) {
    pages++;
    const res: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Canvas returned ${res.status} while listing your courses.`);
    }
    const batch = (await res.json()) as Array<{
      id: number;
      name?: string | null;
      course_code?: string | null;
      term?: { name?: string | null } | null;
    }>;
    for (const c of batch) {
      if (!c?.id || !c.name) continue; // unpublished/restricted stubs
      courses.push({
        id: String(c.id),
        name: c.name,
        courseCode: c.course_code ?? null,
        term: c.term?.name ?? null,
      });
    }
    url = nextLink(res.headers.get("link"), creds.baseUrl);
  }
  courses.sort((a, b) => a.name.localeCompare(b.name));
  return courses;
}
