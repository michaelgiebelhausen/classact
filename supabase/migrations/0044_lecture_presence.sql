-- Presence heartbeat: one row per (lecture, student), bumped every ~30s while
-- the follow-along tab is open — even hidden tabs keep (throttled) timers, so
-- a student reading another site keeps beating while a sleeping/shut-down
-- machine goes silent. Lets scoring stop charging away-time once the machine
-- went silent, and lets the presenter show "disconnected" instead of a
-- forever-red away ring.

create table if not exists public.lecture_presence (
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (lecture_id, enrollment_id)
);

create index if not exists idx_lecture_presence_lecture
  on public.lecture_presence(lecture_id);

alter table public.lecture_presence enable row level security;

-- The student and the course professor can read (mirrors focus_select).
create policy presence_select on public.lecture_presence for select
  using (
    public.owns_enrollment(enrollment_id)
    or exists (select 1 from lectures l
               where l.id = lecture_id and public.is_course_professor(l.course_id))
  );

-- Heartbeats arrive as upserts (INSERT ... ON CONFLICT DO UPDATE), which
-- needs both an insert and an update policy. Only while the lecture is live.
create policy presence_insert on public.lecture_presence for insert
  with check (
    public.owns_enrollment(enrollment_id)
    and exists (select 1 from lectures l
                where l.id = lecture_id and l.ended_at is null)
  );
create policy presence_update on public.lecture_presence for update
  using (public.owns_enrollment(enrollment_id))
  with check (
    public.owns_enrollment(enrollment_id)
    and exists (select 1 from lectures l
                where l.id = lecture_id and l.ended_at is null)
  );

-- Realtime so the presenter's attention map can gray students out live.
-- Default replica identity is enough: UPDATE payloads carry the full new row.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'lecture_presence'
  ) then
    alter publication supabase_realtime add table public.lecture_presence;
  end if;
end $$;
