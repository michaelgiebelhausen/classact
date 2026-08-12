/**
 * Centralized environment access.
 *
 * During early build / local dev the live secrets may be absent. We do NOT hard
 * crash in that case — we expose `isConfigured` flags so features can degrade
 * gracefully (e.g. show a copyable join link instead of sending email). Server
 * code that truly requires a key should call `requireEnv(...)`.
 */

/** Empty strings count as unset. NOTE: every access below is a STATIC
 * `process.env.X` member expression — required so Next.js can inline the
 * NEXT_PUBLIC_* values into client bundles. Never switch to dynamic access. */
const orUndef = (v: string | undefined) => (v && v.length > 0 ? v : undefined)

export const env = {
  supabaseUrl: orUndef(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: orUndef(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseServiceRoleKey: orUndef(process.env.SUPABASE_SERVICE_ROLE_KEY),
  siteUrl: orUndef(process.env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000",
  resendApiKey: orUndef(process.env.RESEND_API_KEY),
  emailFrom: orUndef(process.env.EMAIL_FROM) ?? "ClassAct <noreply@classact.college>",
  canvasBaseUrl: orUndef(process.env.CANVAS_BASE_URL),
  canvasToken: orUndef(process.env.CANVAS_API_TOKEN),
  openrouterApiKey: orUndef(process.env.OPENROUTER_API_KEY),
  openrouterModel:
    orUndef(process.env.OPENROUTER_MODEL) ?? "anthropic/claude-sonnet-5",
  posthogKey: orUndef(process.env.NEXT_PUBLIC_POSTHOG_KEY),
  posthogHost:
    orUndef(process.env.NEXT_PUBLIC_POSTHOG_HOST) ?? "https://us.i.posthog.com",
  sentryDsn: orUndef(process.env.NEXT_PUBLIC_SENTRY_DSN),
  // BYOK vault: 64 hex chars (32 bytes) for AES-256-GCM at-rest encryption.
  appEncryptionKey: orUndef(process.env.APP_ENCRYPTION_KEY),
  // Billing (Stripe). BILLING_ENABLED="true" turns the course-creation gate on.
  stripeSecretKey: orUndef(process.env.STRIPE_SECRET_KEY),
  stripeWebhookSecret: orUndef(process.env.STRIPE_WEBHOOK_SECRET),
  stripePriceId: orUndef(process.env.STRIPE_PRICE_ID),
  billingEnabled: process.env.BILLING_ENABLED === "true",
} as const

export const isConfigured = {
  supabase: Boolean(env.supabaseUrl && env.supabaseAnonKey),
  supabaseAdmin: Boolean(env.supabaseUrl && env.supabaseServiceRoleKey),
  email: Boolean(env.resendApiKey),
  canvas: Boolean(env.canvasBaseUrl && env.canvasToken),
  ai: Boolean(env.openrouterApiKey),
  analytics: Boolean(env.posthogKey),
  sentry: Boolean(env.sentryDsn),
  keyVault: Boolean(env.appEncryptionKey),
  billing: Boolean(
    env.stripeSecretKey && env.stripeWebhookSecret && env.stripePriceId
  ),
} as const

/**
 * Which variables a secret-storing flow (Canvas token, OpenRouter key) is
 * missing. Storing needs the vault key AND the service role, so naming the
 * actual gap beats a message that always blames the encryption key.
 */
export function missingVaultEnv(): string[] {
  const missing: string[] = []
  if (!env.appEncryptionKey) missing.push("APP_ENCRYPTION_KEY")
  if (!env.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY")
  if (!env.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL")
  return missing
}

/** Throw only when a piece of server code genuinely cannot proceed without a key. */
export function requireEnv<K extends keyof typeof env>(key: K): string {
  const value = env[key]
  if (typeof value !== "string" || !value) {
    throw new Error(
      `Missing required environment variable for "${String(key)}". ` +
        `Add it to .env.local (see .env.example) or your Vercel project settings.`
    )
  }
  return value
}

// One-time dev warning so a missing .env.local is obvious but non-fatal.
if (process.env.NODE_ENV !== "production" && !isConfigured.supabase) {
  console.warn(
    "\n[ClassAct] Supabase env vars are not set. Auth/data features will be inert " +
      "until you copy .env.example to .env.local and fill in the keys.\n"
  )
}
