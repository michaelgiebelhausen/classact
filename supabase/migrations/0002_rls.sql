-- ClassAct — Row Level Security, helper functions, triggers, realtime.
-- Mirrors docs/prd.md § Data Model (RLS summary), § Auth, § Security Considerations.
-- Elevated flows (roster import, join/roster-match) run via the service-role
-- client in server code and bypass these policies by design.

-- ---------- Helper functions (SECURITY DEFINER: evaluate membership safely) ----------

create or replace function public.is_course_professor(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from courses c where c.id = p_course and c.professor_id = auth.uid()
  );
$$;

create or replace function public.is_course_member(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from courses c
                where c.id = p_course and c.professor_id = auth.uid())
      or exists(select 1 from enrollments e
                where e.course_id = p_course and e.profile_id = auth.uid()
                  and e.status = 'active');
$$;

create or replace function public.owns_enrollment(p_enrollment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from enrollments e where e.id = p_enrollment and e.profile_id = auth.uid()
  );
$$;

-- true if the target profile is a classmate (shared active course) or the
-- professor/student on the other side of one of my courses.
create or replace function public.shares_active_course(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from enrollments me
    join enrollments them on them.course_id = me.course_id
    where me.profile_id = auth.uid() and me.status = 'active'
      and them.profile_id = p_profile and them.status = 'active'
  ) or exists(
    select 1 from courses c join enrollments e on e.course_id = c.id
    where c.professor_id = auth.uid() and e.profile_id = p_profile
  ) or exists(
    select 1 from courses c join enrollments e on e.course_id = c.id
    where c.professor_id = p_profile and e.profile_id = auth.uid() and e.status = 'active'
  );
$$;

-- ---------- Enable RLS ----------
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.seats enable row level security;
alter table public.enrollments enable row level security;
alter table public.profile_photos enable row level security;
alter table public.student_answers enable row level security;
alter table public.class_sessions enable row level security;
alter table public.check_ins enable row level security;
alter table public.seat_verifications enable row level security;
alter table public.name_game_scores enable row level security;

-- ---------- profiles ----------
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_active_course(id));
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- courses ----------
create policy courses_select on public.courses for select
  using (public.is_course_member(id));
create policy courses_insert on public.courses for insert
  with check (professor_id = auth.uid());
create policy courses_update on public.courses for update
  using (professor_id = auth.uid()) with check (professor_id = auth.uid());
create policy courses_delete on public.courses for delete
  using (professor_id = auth.uid());

-- ---------- seats ----------
create policy seats_select on public.seats for select
  using (public.is_course_member(course_id));
create policy seats_write on public.seats for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- ---------- enrollments (email is PII: students see professor+own only) ----------
create policy enrollments_select on public.enrollments for select
  using (public.is_course_professor(course_id) or profile_id = auth.uid());
create policy enrollments_write on public.enrollments for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- ---------- profile_photos (classmates may view) ----------
create policy photos_select on public.profile_photos for select
  using (profile_id = auth.uid() or public.shares_active_course(profile_id));
create policy photos_write on public.profile_photos for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------- student_answers ----------
create policy answers_select on public.student_answers for select
  using (
    public.owns_enrollment(enrollment_id)
    or exists (select 1 from enrollments e
               where e.id = enrollment_id and public.is_course_professor(e.course_id))
  );
create policy answers_write on public.student_answers for all
  using (public.owns_enrollment(enrollment_id))
  with check (public.owns_enrollment(enrollment_id));

-- ---------- class_sessions ----------
create policy sessions_select on public.class_sessions for select
  using (public.is_course_member(course_id));
create policy sessions_write on public.class_sessions for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- ---------- check_ins ----------
create policy checkins_select on public.check_ins for select
  using (exists (select 1 from class_sessions s
                 where s.id = session_id and public.is_course_member(s.course_id)));
create policy checkins_insert on public.check_ins for insert
  with check (
    public.owns_enrollment(enrollment_id)
    and exists (select 1 from class_sessions s
                where s.id = session_id and s.closed_at is null)
  );
create policy checkins_update_own on public.check_ins for update
  using (public.owns_enrollment(enrollment_id))
  with check (public.owns_enrollment(enrollment_id));

-- ---------- seat_verifications ----------
create policy verif_select on public.seat_verifications for select
  using (exists (select 1 from class_sessions s
                 where s.id = session_id and public.is_course_member(s.course_id)));
create policy verif_insert on public.seat_verifications for insert
  with check (public.owns_enrollment(verifier_enrollment_id));

-- ---------- name_game_scores ----------
create policy scores_select on public.name_game_scores for select
  using (
    public.owns_enrollment(enrollment_id)
    or exists (select 1 from enrollments e
               where e.id = enrollment_id and public.is_course_professor(e.course_id))
  );
create policy scores_insert on public.name_game_scores for insert
  with check (public.owns_enrollment(enrollment_id));

-- ---------- Trigger: auto-create a profile row for each new auth user ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Trigger: a verification marks the subject's check-in verified ----------
create or replace function public.handle_seat_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.check_ins
  set verified = true
  where session_id = new.session_id
    and enrollment_id = new.subject_enrollment_id;
  return new;
end;
$$;

drop trigger if exists on_seat_verification on public.seat_verifications;
create trigger on_seat_verification
  after insert on public.seat_verifications
  for each row execute function public.handle_seat_verification();

-- ---------- Realtime: publish check_ins for the live seat map ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'check_ins'
  ) then
    alter publication supabase_realtime add table public.check_ins;
  end if;
end $$;
