import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { env, isConfigured } from "@/lib/env"
import type { Database } from "@/types/db"

/**
 * Refreshes the Supabase auth session cookie on each request (the `updateSession`
 * pattern from @supabase/ssr). No-ops when Supabase isn't configured yet so the
 * app runs before secrets are wired.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  if (!isConfigured.supabase) {
    return supabaseResponse
  }

  const supabase = createServerClient<Database>(
    env.supabaseUrl!,
    env.supabaseAnonKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: getUser() revalidates the token and triggers cookie refresh.
  await supabase.auth.getUser()

  return supabaseResponse
}
