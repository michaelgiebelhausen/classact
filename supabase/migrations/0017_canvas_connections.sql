-- ClassAct — 0017: per-professor Canvas connections (bring your own token).
-- The env CANVAS_BASE_URL/CANVAS_API_TOKEN pair only ever saw the founder's
-- own courses; every professor now connects their own Canvas access token,
-- stored like the OpenRouter BYOK vault: AES-256-GCM encrypted with
-- APP_ENCRYPTION_KEY, last-4 display only. RLS is enabled with NO policies
-- on purpose — only the service-role key (server actions) can touch rows.

create table if not exists public.professor_canvas (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  base_url text not null,          -- e.g. https://clemson.instructure.com
  token_ciphertext text not null,  -- base64( iv | authTag | data )
  token_last4 text not null,
  connected_name text,             -- Canvas display name at connect time
  updated_at timestamptz not null default now()
);

alter table public.professor_canvas enable row level security;
