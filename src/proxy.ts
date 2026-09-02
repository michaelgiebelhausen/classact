import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (build assets)
     * - favicon and common image files
     * - fonts, stylesheets, scripts, maps, and other plain files
     * - every /api route (each authenticates itself, or is public on purpose)
     *
     * updateSession() is a network round trip to the auth server per request.
     * It earns its keep only on page navigations, where the refreshed cookie
     * matters; on a font file or an API call it was pure latency, and a room
     * of 300 laptops loading a page paid it dozens of times over.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|css|js|map|json|txt|xml|pdf)$).*)",
  ],
}
