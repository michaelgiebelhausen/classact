-- ClassAct — Follow Along (live lecture) schema.
-- Decks are professor-uploaded PDFs (or Google Slides links); a lecture is one
-- live presentation run of a deck. Students follow the professor's current
-- page in realtime, keep private notes, and have tab-away focus events logged.

-- ---------- Tables ----------

create table if not exists public.lecture_decks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  kind text not null default 'pdf' check (kind in ('pdf','google_slides')),
  storage_path text,   -- pdf kind: object in the lecture-decks bucket
  embed_url text,      -- google_slides kind: published embed URL
  page_count int,
  created_at timestamptz not null default now()
);

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  deck_id uuid not null references public.lecture_decks(id) on delete cascade,
  current_page int not null default 1,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Only one live lecture per course at a time.
create unique index if not exists idx_lectures_one_live
  on public.lectures(course_id) where ended_at is null;

-- Private per-student notes for a lecture (professor cannot read them).
create table if not exists public.lecture_notes (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique (lecture_id, enrollment_id)
);

-- Focus events: the student's tab went away / came back during a live lecture.
create table if not exists public.focus_events (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  event_type text not null check (event_type in ('away','back')),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_decks_course on public.lecture_decks(course_id);
create index if not exists idx_lectures_course on public.lectures(course_id);
create index if not exists idx_lecture_notes_lecture on public.lecture_notes(lecture_id);
create index if not exists idx_focus_events_lecture on public.focus_events(lecture_id);
create index if not exists idx_focus_events_enrollment on public.focus_events(enrollment_id);

-- ---------- RLS ----------

alter table public.lecture_decks enable row level security;
alter table public.lectures enable row level security;
alter table public.lecture_notes enable row level security;
alter table public.focus_events enable row level security;

create policy decks_select on public.lecture_decks for select
  using (public.is_course_member(course_id));
create policy decks_write on public.lecture_decks for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

create policy lectures_select on public.lectures for select
  using (public.is_course_member(course_id));
create policy lectures_write on public.lectures for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Notes are private to their author — even the professor can't read them.
create policy notes_all_own on public.lecture_notes for all
  using (public.owns_enrollment(enrollment_id))
  with check (public.owns_enrollment(enrollment_id));

-- Students write their own focus events (only while the lecture is live);
-- the student and the course professor can read them.
create policy focus_select on public.focus_events for select
  using (
    public.owns_enrollment(enrollment_id)
    or exists (select 1 from lectures l
               where l.id = lecture_id and public.is_course_professor(l.course_id))
  );
create policy focus_insert on public.focus_events for insert
  with check (
    public.owns_enrollment(enrollment_id)
    and exists (select 1 from lectures l
                where l.id = lecture_id and l.ended_at is null)
  );

-- ---------- Storage: private bucket for deck PDFs ----------
-- Objects live at `{courseId}/{uuid}.pdf`. Professor of the course has full
-- control; course members can read. App serves via signed URLs.

insert into storage.buckets (id, name, public)
values ('lecture-decks', 'lecture-decks', false)
on conflict (id) do nothing;

drop policy if exists decks_professor_all on storage.objects;
create policy decks_professor_all on storage.objects for all
  using (
    bucket_id = 'lecture-decks'
    and public.is_course_professor(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'lecture-decks'
    and public.is_course_professor(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists decks_member_read on storage.objects;
create policy decks_member_read on storage.objects for select
  using (
    bucket_id = 'lecture-decks'
    and public.is_course_member(((storage.foldername(name))[1])::uuid)
  );

-- ---------- Realtime: live page sync + live attention roster ----------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'lectures'
  ) then
    alter publication supabase_realtime add table public.lectures;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'focus_events'
  ) then
    alter publication supabase_realtime add table public.focus_events;
  end if;
end $$;
