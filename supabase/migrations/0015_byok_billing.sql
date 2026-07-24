-- ClassAct — BYOK + billing (docs/byok-billing-plan.md).
-- Professors bring their own OpenRouter key (encrypted at rest, service-role
-- access only) and pick models per AI task; billing gates course creation
-- ($5/mo via Stripe) with founder/comp bypasses. The system env key remains
-- for platform-level AI and founder courses only.

-- ---------- Professor AI credentials (BYOK vault) ----------

create table if not exists public.professor_ai (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  -- AES-256-GCM ciphertext (base64 iv|tag|data); plaintext never stored.
  key_ciphertext text not null,
  key_last4 text not null default '',
  -- { default, taste?, rubric?, baseline?, scoring?, questions?, pricing? }
  models jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS on with NO policies: only the service role can touch this table.
-- Server actions are the sole gatekeepers of key material.
alter table public.professor_ai enable row level security;

-- ---------- Billing + access flags on profiles ----------

alter table public.profiles
  add column if not exists founder boolean not null default false,
  add column if not exists comp boolean not null default false,
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_status text;

create index if not exists idx_profiles_stripe_customer
  on public.profiles(stripe_customer_id);

-- ---------- Assignments: analysis can pause awaiting a working key ----------

alter table public.assignments drop constraint if exists assignments_state_check;
alter table public.assignments add constraint assignments_state_check
  check (state in ('open','analyzing','awaiting_key','peer_review','finalizing','published'));
