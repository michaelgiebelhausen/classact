import { redirect } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import type { ProfileRow } from "@/types/db"

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

/** Redirect unless the user is a professor. Returns the profile. */
export async function requireProfessor(): Promise<ProfileRow> {
  const profile = await getProfile()
  if (!profile) redirect("/login")
  if (profile.role !== "professor") redirect("/dashboard")
  return profile
}
