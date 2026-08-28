import { redirect } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import type { ProfileRow } from "@/types/db"
import type { Membership } from "@/lib/membership"

/** Current authenticated user, or null. Safe to call before secrets are wired. */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/** Current user's profile row, or null if unauthenticated / no profile yet. */
export async function getProfile(): Promise<ProfileRow | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()
  return (data as ProfileRow | null) ?? null
}

/** Redirect to /login unless authenticated. Returns the user. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser()
  if (!user) redirect("/login")
  return user
}

/**
 * What this person actually belongs to: courses they own, classes they're in.
 *
 * This replaces reading `profiles.role`. Two counts, both read through RLS —
 * courses are scoped to `professor_id = auth.uid()` and enrollments to your
 * own profile, so this can only ever see your own standing. See
 * src/lib/membership.ts for why the role is derived rather than stored.
 *
 * A failed count is reported as such rather than folded into zero. Zero is
 * the answer that means "brand-new account, show them the chooser", and
 * silently handing that to a professor whose query hiccuped would tell them
 * their courses are gone.
 */
export async function getMembership(
  profileId: string
): Promise<Membership | null> {
  const supabase = await createClient()
  const [taught, joined] = await Promise.all([
    supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("professor_id", profileId),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .neq("status", "dropped"),
  ])
  if (taught.error || joined.error) return null
  return {
    coursesTaught: taught.count ?? 0,
    classesJoined: joined.count ?? 0,
  }
}
