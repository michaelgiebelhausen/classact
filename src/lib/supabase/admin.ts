import "server-only"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { requireEnv } from "@/lib/env"
import type { Database } from "@/types/db"

/**
 * Service-role Supabase client. **Server-only** — the `server-only` import makes
 * bundling this into client code a build error. Bypasses RLS, so every caller
 * MUST perform its own ownership/authorization checks first (e.g. confirm the
 * acting user owns the course before importing a roster).
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    requireEnv("supabaseUrl"),
    requireEnv("supabaseServiceRoleKey"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
