-- ClassAct — Participate (think-pair-share polling).
-- Grounded in Peer Instruction (Crouch & Mazur 2001): individual think vote,
-- paired discussion, re-vote, then reveal. Questions live in a per-deck bank
-- (AI-generated or professor-written) and only approved ones run in class.

-- ---------- Deck additions: one Reading/Reference PDF per deck ----------

alter table public.lecture_decks
  add column if not exists reading_path text,
  add column if not exists reading_title text;

-- ---------- Tables ----------

-- Question bank per deck. correct_indices is the professor/AI answer key and
-- must NEVER be readable by students (see RLS below — professor-only table).
create table if not exists public.deck_questions (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.lecture_decks(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  prompt text not null,
  options jsonb not null default '[]'::jsonb,          -- array of option strings
  correct_indices jsonb not null default '[]'::jsonb,  -- array of option indexes
  rationale text,                 -- AI: why this question, why this position
  position_after_page int not null default 1,
  approved boolean not null default false,
  source text not null default 'professor' check (source in ('ai','professor')),
  created_at timestamptz not null default now()
);

-- One live run of a question during a lecture. Prompt/options are snapshotted
-- here so students never need read access to deck_questions, and so an edit
-- mid-lecture can't shift a poll in flight. correct_indices and results stay
-- NULL until the professor reveals — until then students cannot read the key.
create table if not exists public.poll_rounds (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  question_id uuid references public.deck_questions(id) on delete set null,
  prompt text not null,
  options jsonb not null,
  stage text not null default 'think'
    check (stage in ('think','pair','revote','reveal','closed')),
  correct_indices jsonb,   -- written when the professor marks the answer
  results jsonb,           -- {"think": int[], "revote": int[]} written at reveal
  started_at timestamptz not null default now(),
  revealed_at timestamptz,
  closed_at timestamptz
);

-- Only one open round per lecture at a time.
create unique index if not exists idx_poll_rounds_one_open
  on public.poll_rounds(lecture_id) where stage <> 'closed';

-- Student votes: one per phase (think = before discussion, revote = after).
create table if not exists public.poll_answers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.poll_rounds(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  phase text not null check (phase in ('think','revote')),
  choice int not null check (choice >= 0),
  answered_at timestamptz not null default now(),
  unique (round_id, enrollment_id, phase)
);

-- Discussion groups assigned at the pair stage (2, or 3 when odd).
create table if not exists public.poll_pairs (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.poll_rounds(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  member_ids jsonb not null,   -- array of enrollment ids
  created_at timestamptz not null default now()
);

create index if not exists idx_deck_questions_deck on public.deck_questions(deck_id);
create index if not exists idx_deck_questions_course on public.deck_questions(course_id);
create index if not exists idx_poll_rounds_lecture on public.poll_rounds(lecture_id);
create index if not exists idx_poll_rounds_course on public.poll_rounds(course_id);
create index if not exists idx_poll_answers_round on public.poll_answers(round_id);
create index if not exists idx_poll_answers_enrollment on public.poll_answers(enrollment_id);
create index if not exists idx_poll_pairs_round on public.poll_pairs(round_id);
create index if not exists idx_poll_pairs_course on public.poll_pairs(course_id);

-- ---------- RLS ----------

alter table public.deck_questions enable row level security;
alter table public.poll_rounds enable row level security;
alter table public.poll_answers enable row level security;
alter table public.poll_pairs enable row level security;

-- Question bank (holds the answer key): professor only, both directions.
create policy deck_questions_professor_all on public.deck_questions for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Rounds: members read (the answer key is NULL until reveal), professor writes.
create policy poll_rounds_select on public.poll_rounds for select
  using (public.is_course_member(course_id));
create policy poll_rounds_write on public.poll_rounds for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- Answers: students read their own; the professor reads all (live tallies).
-- Students never see classmates' votes — distributions only arrive via
-- poll_rounds.results at reveal.
create policy poll_answers_select on public.poll_answers for select
  using (
    public.owns_enrollment(enrollment_id)
    or exists (select 1 from poll_rounds r
               where r.id = round_id and public.is_course_professor(r.course_id))
  );
-- Voting is only valid while the round is in the matching stage.
create policy poll_answers_insert on public.poll_answers for insert
  with check (
    public.owns_enrollment(enrollment_id)
    and exists (select 1 from poll_rounds r
                where r.id = round_id and r.stage = phase)
  );
create policy poll_answers_update on public.poll_answers for update
  using (public.owns_enrollment(enrollment_id))
  with check (
    public.owns_enrollment(enrollment_id)
    and exists (select 1 from poll_rounds r
                where r.id = round_id and r.stage = phase)
  );

-- Pairs: members read (students must find their partner), professor writes.
create policy poll_pairs_select on public.poll_pairs for select
  using (public.is_course_member(course_id));
create policy poll_pairs_write on public.poll_pairs for all
  using (public.is_course_professor(course_id))
  with check (public.is_course_professor(course_id));

-- ---------- Realtime: round stage sync, live tallies, pair assignments ----------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'poll_rounds'
  ) then
    alter publication supabase_realtime add table public.poll_rounds;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'poll_answers'
  ) then
    alter publication supabase_realtime add table public.poll_answers;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'poll_pairs'
  ) then
    alter publication supabase_realtime add table public.poll_pairs;
  end if;
end $$;
