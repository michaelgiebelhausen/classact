-- ClassAct — 0036: neighbors can say no, and the professor can say yes.
--
-- Peer confirmation is the anti-proxy-check-in mechanism, and this migration
-- gives it the two missing halves:
--
--   1. A student can DENY a neighbor's seat claim ("Alex is not in the seat
--      to my left") — the actual signature of a proxy check-in, caught live.
--   2. The professor can CONFIRM a student's attendance from the map, for the
--      cases peers can't cover (edge seats, ignored prompts, disputes).
--
-- Design constraints this migration honors:
--
--   * Realtime rides check_ins only. Every client already subscribes to
--     check_ins filtered by session; adding tables to the publication would
--     multiply per-subscriber RLS evaluation during the arrival rush. So
--     denials and professor confirmations are carried as columns on
--     check_ins, kept true by triggers — one UPDATE per event, one realtime
--     message. seat_denials itself stays OUT of the publication on purpose.
--
--   * denied_count is always RECOUNTED from active denials, never
--     incremented, so concurrent deny/confirm can't drift. A count (not a
--     boolean) lets the professor's popup say "2 neighbors say not here".
--
--   * Every confirmation path (peer or professor) resolves all active
--     denials in the same transaction. The resulting invariant — an active
--     denial is always NEWER than the last confirmation — is what lets the
--     UI give the denial ring precedence over the green ring without a
--     timestamp comparison.
--
--   * Denials are never deleted, only resolved (resolved_at/resolved_by),
--     so a dispute leaves an audit trail. The partial unique index scopes
--     "one active denial per verifier per subject" while letting history
--     accumulate (deny -> confirm -> deny again works).

-- ---------- 1. check_ins: realtime carrier columns ----------

alter table public.check_ins
  add column if not exists denied_count int not null default 0,
  add column if not exists professor_confirmed_at timestamptz;

-- ---------- 2. seat_denials ----------

create table if not exists public.seat_denials (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  verifier_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  subject_enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  relation text not null check (relation in ('front','back','left','right')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text check (resolved_by in
    ('peer_confirm','professor_confirm','seat_change','checkin_removed'))
);

create unique index if not exists uq_seat_denials_active
  on public.seat_denials(session_id, verifier_enrollment_id, subject_enrollment_id)
  where resolved_at is null;
create index if not exists idx_denials_active_subject
  on public.seat_denials(session_id, subject_enrollment_id)
  where resolved_at is null;

-- ---------- 3. seat_verifications: indexes for the "ever met" lookups ----------
-- The first-ever-met probe and peopleMet both scan by either party; only
-- idx_verif_session existed before this.

create index if not exists idx_verif_verifier
  on public.seat_verifications(verifier_enrollment_id);
create index if not exists idx_verif_subject
  on public.seat_verifications(subject_enrollment_id);

-- ---------- 4. RLS ----------

alter table public.seat_denials enable row level security;

drop policy if exists denials_select on public.seat_denials;
create policy denials_select on public.seat_denials for select
  using (exists (select 1 from class_sessions s
                 where s.id = session_id and public.is_course_member(s.course_id)));

drop policy if exists denials_insert on public.seat_denials;
create policy denials_insert on public.seat_denials for insert
  with check (
    public.owns_enrollment(verifier_enrollment_id)
    and exists (select 1 from class_sessions s
                where s.id = session_id and s.closed_at is null)
  );
-- Deliberately NO update/delete policies: a denial is resolved only inside
-- SECURITY DEFINER triggers and the professor RPC, never by a student.

-- verifyNeighbor becomes an upsert so a REPEAT confirmation re-fires the
-- verification trigger (that is what clears a denial after a mis-tap). The
-- conflict-update path needs an UPDATE policy or it dies with 42501.
drop policy if exists verif_update_own on public.seat_verifications;
create policy verif_update_own on public.seat_verifications for update
  using (public.owns_enrollment(verifier_enrollment_id))
  with check (public.owns_enrollment(verifier_enrollment_id));

-- No FOR DELETE policy on check_ins existed in any migration, which means
-- releaseSeat — which deletes through the regular RLS client — matched zero
-- rows and reported success. The professor's "free this seat" appeared to
-- work on their own screen (optimistic UI) while the row survived for
-- everyone else. If an equivalent policy was ever applied by hand in the SQL
-- editor, this is a no-op thanks to the drop-and-recreate.
drop policy if exists checkins_delete_professor on public.check_ins;
create policy checkins_delete_professor on public.check_ins for delete
  using (exists (select 1 from class_sessions s
                 where s.id = session_id and public.is_course_professor(s.course_id)));

-- ---------- 5. Trigger: a denial recounts the subject's denied_count ----------

create or replace function public.handle_seat_denial()
returns trigger language plpgsql security definer set search_path = public as $fn_denial$
begin
  update public.check_ins
     set denied_count = (
       select count(*) from seat_denials d
        where d.session_id = new.session_id
          and d.subject_enrollment_id = new.subject_enrollment_id
          and d.resolved_at is null
     )
   where session_id = new.session_id
     and enrollment_id = new.subject_enrollment_id;
  return new;
end;
$fn_denial$;

drop trigger if exists on_seat_denial on public.seat_denials;
create trigger on_seat_denial
  after insert on public.seat_denials
  for each row execute function public.handle_seat_denial();

-- ---------- 6. REPLACE handle_seat_verification ----------
-- Two changes from 0002: it resolves active denials (a confirmation is newer
-- information than any standing denial), and it fires on UPDATE too — the
-- upsert's conflict path is how a re-confirmation clears a denial.

create or replace function public.handle_seat_verification()
returns trigger language plpgsql security definer set search_path = public as $fn_verif$
begin
  update public.seat_denials
     set resolved_at = now(), resolved_by = 'peer_confirm'
   where session_id = new.session_id
     and subject_enrollment_id = new.subject_enrollment_id
     and resolved_at is null;
  update public.check_ins
     set verified = true, denied_count = 0
   where session_id = new.session_id
     and enrollment_id = new.subject_enrollment_id
     and (verified is distinct from true or denied_count is distinct from 0);
  return new;
end;
$fn_verif$;

drop trigger if exists on_seat_verification on public.seat_verifications;
create trigger on_seat_verification
  after insert or update on public.seat_verifications
  for each row execute function public.handle_seat_verification();

-- ---------- 7. check_ins lifecycle: keep the carrier columns honest ----------

-- A seat change moots any standing denial: "not in the seat to my left" was
-- about the seat they just left. BEFORE + mutating NEW, so there is no second
-- UPDATE (and no trigger recursion, and no second realtime event).
create or replace function public.handle_checkin_seat_change()
returns trigger language plpgsql security definer set search_path = public as $fn_seatchg$
begin
  if new.seat_id is distinct from old.seat_id then
    update public.seat_denials
       set resolved_at = now(), resolved_by = 'seat_change'
     where session_id = new.session_id
       and subject_enrollment_id = new.enrollment_id
       and resolved_at is null;
    new.denied_count := 0;
  end if;
  return new;
end;
$fn_seatchg$;

drop trigger if exists on_checkin_seat_change on public.check_ins;
create trigger on_checkin_seat_change
  before update of seat_id on public.check_ins
  for each row execute function public.handle_checkin_seat_change();

-- A removed check-in (releaseSeat, or the delete half of a swap) resolves the
-- denials that pointed at it.
create or replace function public.handle_checkin_removed()
returns trigger language plpgsql security definer set search_path = public as $fn_removed$
begin
  update public.seat_denials
     set resolved_at = now(), resolved_by = 'checkin_removed'
   where session_id = old.session_id
     and subject_enrollment_id = old.enrollment_id
     and resolved_at is null;
  return old;
end;
$fn_removed$;

drop trigger if exists on_checkin_removed on public.check_ins;
create trigger on_checkin_removed
  after delete on public.check_ins
  for each row execute function public.handle_checkin_removed();

-- A fresh check-in seeds its columns from what this session already knows.
-- verified: moveSeat deliberately preserves verification ("the vouch says
-- they're in the room"), so a release-then-recheck-in keeps it too — same
-- semantics however the row came back. denied_count: closes the race where a
-- denial landed between a release and a re-check-in.
create or replace function public.handle_checkin_seeded()
returns trigger language plpgsql security definer set search_path = public as $fn_seeded$
begin
  if exists (
    select 1 from seat_verifications v
     where v.session_id = new.session_id
       and v.subject_enrollment_id = new.enrollment_id
  ) then
    new.verified := true;
  end if;
  new.denied_count := (
    select count(*) from seat_denials d
     where d.session_id = new.session_id
       and d.subject_enrollment_id = new.enrollment_id
       and d.resolved_at is null
  );
  return new;
end;
$fn_seeded$;

drop trigger if exists on_checkin_seeded on public.check_ins;
create trigger on_checkin_seeded
  before insert on public.check_ins
  for each row execute function public.handle_checkin_seeded();

-- ---------- 8. Professor confirmation RPC ----------
-- SECURITY DEFINER for the same reason as reassign_seat (0029): professors
-- have no enrollment and no UPDATE policy on check_ins, and an RLS policy
-- letting them update rows would let them update ANY column. The function is
-- the authorization boundary.

create or replace function public.professor_confirm_attendance(
  p_session uuid,
  p_enrollment uuid
) returns void
language plpgsql
security definer
set search_path = public
as $fn_confirm$
declare
  v_course uuid;
  v_closed timestamptz;
begin
  select course_id, closed_at into v_course, v_closed
    from class_sessions where id = p_session;

  if v_course is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if not public.is_course_professor(v_course) then
    raise exception 'not the course professor' using errcode = '42501';
  end if;

  if v_closed is not null then
    raise exception 'session closed' using errcode = 'P0003';
  end if;

  update public.seat_denials
     set resolved_at = now(), resolved_by = 'professor_confirm'
   where session_id = p_session
     and subject_enrollment_id = p_enrollment
     and resolved_at is null;

  -- coalesce keeps the FIRST confirmation time if the professor taps twice.
  update public.check_ins
     set professor_confirmed_at = coalesce(professor_confirmed_at, now()),
         denied_count = 0
   where session_id = p_session
     and enrollment_id = p_enrollment;

  if not found then
    raise exception 'student not checked in' using errcode = 'P0007';
  end if;
end;
$fn_confirm$;

revoke all on function public.professor_confirm_attendance(uuid, uuid) from public;
grant execute on function public.professor_confirm_attendance(uuid, uuid) to authenticated;

-- ---------- 9. REPLACE reassign_seat ----------
-- Identical to 0029 except the swap's re-insert now carries the occupant's
-- professor confirmation. Without this, a professor swap silently stripped
-- professor_confirmed_at from the displaced student (the explicit column
-- list didn't know about it). denied_count is deliberately NOT carried: the
-- occupant's seat changed, so their denials were just resolved by the delete
-- trigger, and the insert trigger reseeds the column.

create or replace function public.reassign_seat(
  p_session uuid,
  p_enrollment uuid,
  p_seat uuid
) returns void
language plpgsql
security definer
set search_path = public
as $fn_reassign$
declare
  v_course  uuid;
  v_closed  timestamptz;
  v_mine    check_ins%rowtype;
  v_other   check_ins%rowtype;
begin
  select course_id, closed_at into v_course, v_closed
    from class_sessions where id = p_session;

  if v_course is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if not public.is_course_professor(v_course) then
    raise exception 'not the course professor' using errcode = '42501';
  end if;

  if v_closed is not null then
    raise exception 'session closed' using errcode = 'P0003';
  end if;

  if not exists (
    select 1 from seats where id = p_seat and course_id = v_course
  ) then
    raise exception 'seat not in this course' using errcode = 'P0004';
  end if;

  if not exists (
    select 1 from enrollments
     where id = p_enrollment and course_id = v_course and status <> 'dropped'
  ) then
    raise exception 'student not on this roster' using errcode = 'P0005';
  end if;

  select * into v_mine
    from check_ins
   where session_id = p_session and enrollment_id = p_enrollment;

  select * into v_other
    from check_ins
   where session_id = p_session and seat_id = p_seat;

  if v_mine.id is not null and v_mine.seat_id = p_seat then
    return;
  end if;

  if v_other.id is null then
    if v_mine.id is null then
      insert into check_ins (session_id, enrollment_id, seat_id, is_new_seat)
      values (
        p_session,
        p_enrollment,
        p_seat,
        not exists (
          select 1 from check_ins
           where enrollment_id = p_enrollment and seat_id = p_seat
        )
      );
    else
      update check_ins set seat_id = p_seat where id = v_mine.id;
    end if;
    return;
  end if;

  if v_mine.id is null then
    raise exception 'seat already taken' using errcode = 'P0006';
  end if;

  delete from check_ins where id = v_other.id;
  update check_ins set seat_id = p_seat where id = v_mine.id;
  insert into check_ins (
    id, session_id, enrollment_id, seat_id, is_new_seat, verified,
    checked_in_at, professor_confirmed_at
  ) values (
    v_other.id,
    p_session,
    v_other.enrollment_id,
    v_mine.seat_id,
    v_other.is_new_seat,
    v_other.verified,
    v_other.checked_in_at,
    v_other.professor_confirmed_at
  );
end;
$fn_reassign$;

revoke all on function public.reassign_seat(uuid, uuid, uuid) from public;
grant execute on function public.reassign_seat(uuid, uuid, uuid) to authenticated;
