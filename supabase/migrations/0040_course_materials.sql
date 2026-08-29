-- 0040: course materials — transcripts, syllabus, extracted text, Ask the TA.
--
-- Three things land together because they share one idea: the course's
-- teaching materials become a corpus the platform can hand back to students,
-- either as downloads (transcripts, gated by a professor toggle) or as
-- grounded AI answers (Ask the TA).

-- ---------- lecture_decks: transcript + extracted text ----------
-- The text columns can run 100k+ characters each. Every existing call site
-- selects explicit column lists; keep it that way — never add these to a
-- broad select that feeds a page render.
alter table public.lecture_decks
  add column if not exists transcript_path text,
  add column if not exists transcript_title text,
  add column if not exists transcript_text text,
  add column if not exists deck_text text,
  add column if not exists reading_text text;

-- ---------- courses: download toggle + syllabus ----------
alter table public.courses
  add column if not exists transcripts_downloadable boolean not null default true,
  add column if not exists syllabus_path text,
  add column if not exists syllabus_title text,
  add column if not exists syllabus_text text;

-- ---------- Storage: course-materials bucket ----------
-- {courseId}/transcript-{uuid}.{txt|md|vtt}  — professor writes
-- {courseId}/syllabus-{uuid}.{pdf|txt|md}    — professor writes
--
-- Deliberately NO member-read policy: transcript downloads are minted
-- server-side with the admin client only while courses.transcripts_downloadable
-- is true. Putting these in lecture-decks (member-read on the whole course
-- prefix) would make that toggle a fiction.
insert into storage.buckets (id, name, public)
values ('course-materials', 'course-materials', false)
on conflict (id) do nothing;

drop policy if exists course_materials_professor_all on storage.objects;
create policy course_materials_professor_all on storage.objects for all
  using (
    bucket_id = 'course-materials'
    and public.is_course_professor(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'course-materials'
    and public.is_course_professor(((storage.foldername(name))[1])::uuid)
  );

-- ---------- Ask the TA: private chat threads ----------
-- Keyed by profile_id, not enrollment_id — the professor has no enrollment
-- row and should be able to try their own TA. Threads are private to their
-- author on the same principle as lecture notes: nobody else has a read
-- path, the professor included. Students may insert only their own 'user'
-- turns; assistant turns are written by the service role in askTa, so a
-- student cannot forge context the model would later trust.
create table if not exists public.ta_messages (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- (profile, time) loads a thread; (course, role, time) backs the per-course
-- daily spend cap, which counts user turns in the last 24h.
create index if not exists ta_messages_profile_idx
  on public.ta_messages (profile_id, course_id, created_at);
create index if not exists ta_messages_course_rate_idx
  on public.ta_messages (course_id, role, created_at);

alter table public.ta_messages enable row level security;

drop policy if exists ta_messages_own_read on public.ta_messages;
create policy ta_messages_own_read on public.ta_messages for select
  using (profile_id = auth.uid());

drop policy if exists ta_messages_own_insert on public.ta_messages;
create policy ta_messages_own_insert on public.ta_messages for insert
  with check (
    profile_id = auth.uid()
    and role = 'user'
    and public.is_course_member(course_id)
  );

drop policy if exists ta_messages_own_delete on public.ta_messages;
create policy ta_messages_own_delete on public.ta_messages for delete
  using (profile_id = auth.uid());
