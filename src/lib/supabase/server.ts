import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { env } from "@/lib/env"
import type { Database } from "@/types/db"

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Bound to the request cookie jar so auth sessions persist. `cookies()` is
 * async in Next 15+/16, hence this factory is async.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    env.supabaseUrl ?? "http://placeholder.supabase.co",
    env.supabaseAnonKey ?? "placeholder-anon-key",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    }
  )
}
