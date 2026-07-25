-- ClassAct — 0018: in-app feedback (bugs, improvements, feature requests).
-- Anyone signed in can file feedback and see their own submissions (with
-- status, so reports don't feel swallowed). Founders read and triage the
-- full list through the service role — no founder RLS policy needed.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('bug','improvement','feature')),
  body text not null,
  page_path text,
  status text not null default 'new'
    check (status in ('new','planned','done','closed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_profile on public.feedback(profile_id);
create index if not exists idx_feedback_created on public.feedback(created_at desc);

alter table public.feedback enable row level security;

create policy feedback_insert_own on public.feedback for insert
  with check (profile_id = auth.uid());
create policy feedback_select_own on public.feedback for select
  using (profile_id = auth.uid());
