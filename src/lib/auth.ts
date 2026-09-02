import { cache } from "react"
import { redirect } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import type { ProfileRow } from "@/types/db"
import type { Membership } from "@/lib/membership"

/**
 * Current authenticated user, or null. Safe to call before secrets are wired.
 *
 * Wrapped in React's per-request `cache`: `getUser()` is a network round trip
 * to the auth server (which reads auth.users), and one page render used to
 * make it three times over — app layout, course layout, page — before doing
 * any of its own work. Within a single request the answer can't change, so
 * the first caller pays and the rest share.
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

/**
 * Current user's profile row, or null if unauthenticated / no profile yet.
 * Per-request cached for the same reason as getSessionUser: the layouts and
 * the page each ask, and the row can't differ between them.
 */
export const getProfile = cache(async (): Promise<ProfileRow | null> => {
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()
  return (data as ProfileRow | null) ?? null
})

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
