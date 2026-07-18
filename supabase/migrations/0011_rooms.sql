-- ClassAct — Room setup v2: seat geometry + shared room database.
-- Seats gain real positions (seat units), section/table membership, and
-- persisted neighbor links (replacing row/col grid arithmetic). Rooms become
-- first-class, reusable records keyed university → building → room, so a
-- professor can pick their room instead of rebuilding it.

-- ---------- Seat geometry ----------

alter table public.seats
  add column if not exists x double precision,
  add column if not exists y double precision,
  add column if not exists section text not null default 'main',
  add column if not exists table_id text,
  add column if not exists neighbors jsonb not null default '{}'::jsonb;

-- Non-grid layouts have no meaningful row/col.
alter table public.seats alter column row_index drop not null;
alter table public.seats alter column col_index drop not null;

-- Backfill existing grid rooms: x = col, y = row · 1.25 (seat units), and
-- neighbor labels from grid adjacency — matches lib/roomlayout gridLayout().
update public.seats set
  x = col_index,
  y = row_index * 1.25
where x is null;

update public.seats s set neighbors = (
  select coalesce(jsonb_strip_nulls(jsonb_build_object(
    'front', (select n.label from public.seats n
              where n.course_id = s.course_id
                and n.row_index = s.row_index - 1 and n.col_index = s.col_index),
    'back',  (select n.label from public.seats n
              where n.course_id = s.course_id
                and n.row_index = s.row_index + 1 and n.col_index = s.col_index),
    'left',  (select n.label from public.seats n
              where n.course_id = s.course_id
                and n.row_index = s.row_index and n.col_index = s.col_index - 1),
    'right', (select n.label from public.seats n
              where n.course_id = s.course_id
                and n.row_index = s.row_index and n.col_index = s.col_index + 1)
  )), '{}'::jsonb)
)
where s.neighbors = '{}'::jsonb and s.row_index is not null;

-- ---------- Shared room database ----------

create table if not exists public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Email domain for auto-matching professors, e.g. 'purdue.edu'.
  domain text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (university_id, name)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  -- Null building = a private room not (yet) attached to a campus location.
  building_id uuid references public.buildings(id) on delete set null,
  room_number text,
  layout jsonb not null,
  layout_version int not null default 1,
  capacity int not null,
  layout_type text not null,
  source text not null default 'professor'
    check (source in ('professor','ai_import','seed')),
  verified boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rooms_building_idx on public.rooms(building_id);
create index if not exists buildings_university_idx on public.buildings(university_id);

alter table public.profiles
  add column if not exists university_id uuid references public.universities(id) on delete set null;

alter table public.courses
  add column if not exists room_id uuid references public.rooms(id) on delete set null;

-- ---------- RLS ----------

alter table public.universities enable row level security;
alter table public.buildings enable row level security;
alter table public.rooms enable row level security;

-- The room database is shared infrastructure: any signed-in user can browse,
-- professors contribute, creators edit their own contributions.
create policy universities_select on public.universities for select
  using (auth.role() = 'authenticated');
create policy universities_insert on public.universities for insert
  with check (exists(
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'professor'
  ));

create policy buildings_select on public.buildings for select
  using (auth.role() = 'authenticated');
create policy buildings_insert on public.buildings for insert
  with check (exists(
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'professor'
  ));

create policy rooms_select on public.rooms for select
  using (auth.role() = 'authenticated');
create policy rooms_insert on public.rooms for insert
  with check (
    created_by = auth.uid()
    and exists(
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'professor'
    )
  );
create policy rooms_update on public.rooms for update
  using (created_by = auth.uid());
