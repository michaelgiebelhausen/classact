-- ClassAct — initial schema
-- Mirrors docs/prd.md § Data Model. Apply via `supabase db push` or the SQL editor.

-- profiles: 1:1 with auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('student','professor')),
  full_name text,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now()
);

-- courses
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  term text,
  join_code text not null unique,
  icebreaker_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- seats: room layout for a course
create table if not exists public.seats (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  label text not null,
  row_index int not null,
  col_index int not null,
  unique (course_id, label),
  unique (course_id, row_index, col_index)
);

-- enrollments: roster rows; profile_id null until the student activates
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  roster_name text not null,
  roster_email text not null,
  status text not null default 'invited' check (status in ('invited','active')),
  created_at timestamptz not null default now(),
  unique (course_id, roster_email)
);

-- profile_photos: up to 3 per student (candid / professional / adventure)
create table if not exists public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('candid','professional','adventure')),
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, kind)
);

-- student_answers: icebreaker responses, scoped per enrollment
create table if not exists public.student_answers (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  field_key text not null,
  value text not null,
  unique (enrollment_id, field_key)
);

-- class_sessions: one per class meeting
create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  session_date date not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (course_id, session_date)
);

-- check_ins: a student claims a seat in a session
create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  seat_id uuid not null references public.seats(id) on delete cascade,
  is_new_seat boolean not null default false,
  verified boolean not null default false,
  checked_in_at timestamptz not null default now(),
  unique (session_id, enrollment_id),
  unique (session_id, seat_id)
);

-- seat_verifications: peer confirmation of neighbors
create table if not exists public.seat_verifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  verifier_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  subject_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  relation text not null check (relation in ('front','back','left','right')),
  created_at timestamptz not null default now(),
  unique (session_id, verifier_enrollment_id, subject_enrollment_id)
);

-- name_game_scores
create table if not exists public.name_game_scores (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  game_type text not null check (game_type in ('memory_tiles','flash_cards')),
  score int not null,
  duration_ms int,
  played_at timestamptz not null default now()
);

-- Indexes (hot paths: course/session-scoped reads + realtime seat map)
create index if not exists idx_courses_professor on public.courses(professor_id);
create index if not exists idx_seats_course on public.seats(course_id);
create index if not exists idx_enrollments_course on public.enrollments(course_id);
create index if not exists idx_enrollments_profile on public.enrollments(profile_id);
create index if not exists idx_photos_profile on public.profile_photos(profile_id);
create index if not exists idx_answers_enrollment on public.student_answers(enrollment_id);
create index if not exists idx_sessions_course on public.class_sessions(course_id);
create index if not exists idx_checkins_session on public.check_ins(session_id);
create index if not exists idx_checkins_enrollment on public.check_ins(enrollment_id);
create index if not exists idx_verif_session on public.seat_verifications(session_id);
create index if not exists idx_scores_enrollment on public.name_game_scores(enrollment_id);
