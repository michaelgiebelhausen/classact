-- ClassAct — 0034: the Markdown file a person attaches to their own profile.
--
-- Its own table rather than a column on `profiles`, because `getProfile()`
-- does `select("*")` and runs on nearly every authenticated page render —
-- including check-in, which forty phones re-render at once at the start of
-- class. A 64 KB text column there would ride along on every one of those.
-- Here it is read only by the page that shows it.
--
-- One row per person: uploading again replaces what is there, which is the
-- only kind of editing the app offers. The file on their machine stays the
-- original.

create table if not exists public.profile_documents (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  -- The name they uploaded, shown back to them so they can tell which file
  -- this is. A label, never a path.
  filename text not null check (filename <> '' and filename !~ '[\\/]'),
  content text not null check (content <> ''),
  -- Belt and braces with the app's own check: a 64 KiB cap the database will
  -- hold even if something reaches it another way. octet_length, not length,
  -- because multi-byte characters are the whole reason a character count is
  -- the wrong measure.
  content_bytes integer not null
    check (content_bytes > 0 and content_bytes <= 65536),
  updated_at timestamptz not null default now()
);

alter table public.profile_documents enable row level security;

-- Owner-only, deliberately. Whatever eventually reads these — a professor, an
-- AI feature — is a decision about who may see somebody's self-description,
-- and it should be made on purpose rather than inherited from a default.
-- Widening this later is one policy; narrowing it after the fact is an
-- apology.
create policy profile_documents_select on public.profile_documents
  for select using (profile_id = auth.uid());
create policy profile_documents_insert on public.profile_documents
  for insert with check (profile_id = auth.uid());
create policy profile_documents_update on public.profile_documents
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
create policy profile_documents_delete on public.profile_documents
  for delete using (profile_id = auth.uid());
