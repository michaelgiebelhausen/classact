import { createBrowserClient } from "@supabase/ssr"
import { env } from "@/lib/env"
import type { Database } from "@/types/db"

/**
 * Supabase client for use in Client Components. Falls back to harmless
 * placeholder credentials when env is unset so the app still builds/renders
 * before secrets are wired (auth/data calls will simply fail gracefully).
 */
export function createClient() {
  return createBrowserClient<Database>(
    env.supabaseUrl ?? "http://placeholder.supabase.co",
    env.supabaseAnonKey ?? "placeholder-anon-key"
  )
}
