-- ClassAct — 0029: let a professor reassign a student's seat mid-class (CA-4c).
--
-- Why this needs to be a database function rather than a few client calls.
--
-- The interesting case is reassigning someone INTO an occupied seat, which in
-- practice means swapping two students — a mis-seated student and the person
-- whose seat they took. check_ins carries `unique (session_id, seat_id)`, and
-- that constraint is not deferrable, so there is no ordering of two UPDATEs
-- that doesn't transiently collide: whichever moves first lands on a seat the
-- other still holds.
--
-- The way through is to delete one row, move the other, and write the first
-- back in its new seat. Done from the client that is three round trips with
-- no transaction around them, and a failure between them permanently destroys
-- a student's attendance record. Inside a function it is one atomic
-- statement: anything that raises rolls the whole thing back, so no student
-- can end up without the check-in they earned.
--
-- SECURITY DEFINER because professors have no UPDATE policy on check_ins
-- (checkins_update_own is scoped to the student). The ownership check is
-- therefore performed here, explicitly, against auth.uid() — the function is
-- the authorization boundary and must not be granted more widely than below.

create or replace function public.reassign_seat(
  p_session uuid,
  p_enrollment uuid,
  p_seat uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- Authorization. Everything below this line assumes the caller owns the
  -- course; nothing above it touches data.
  if not public.is_course_professor(v_course) then
    raise exception 'not the course professor' using errcode = '42501';
  end if;

  if v_closed is not null then
    raise exception 'session closed' using errcode = 'P0003';
  end if;

  -- Both the seat and the student must belong to this course. Without these
  -- a professor could move a student into another class's room, or seat
  -- somebody who isn't on their roster.
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

  -- Already sitting there: nothing to do, and not an error worth surfacing.
  if v_mine.id is not null and v_mine.seat_id = p_seat then
    return;
  end if;

  if v_other.id is null then
    if v_mine.id is null then
      -- Not checked in yet — seat them. `is_new_seat` is derived the same way
      -- the student's own check-in derives it, so the networking score means
      -- the same thing however they came to be in the seat.
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

  -- Target occupied, and the student we're moving has no seat of their own to
  -- give in exchange. Completing this would mean evicting the occupant and
  -- destroying their attendance, so it is refused rather than guessed at.
  if v_mine.id is null then
    raise exception 'seat already taken' using errcode = 'P0006';
  end if;

  -- Swap. Atomic by virtue of being one statement: the occupant is written
  -- back with their original verification, new-seat credit and timestamp, so
  -- a correction costs neither student anything.
  delete from check_ins where id = v_other.id;
  update check_ins set seat_id = p_seat where id = v_mine.id;
  insert into check_ins (
    id, session_id, enrollment_id, seat_id, is_new_seat, verified, checked_in_at
  ) values (
    v_other.id,
    p_session,
    v_other.enrollment_id,
    v_mine.seat_id,
    v_other.is_new_seat,
    v_other.verified,
    v_other.checked_in_at
  );
end;
$$;

-- Only signed-in users may call it, and the function itself decides whether
-- the caller is the professor of that session's course.
revoke all on function public.reassign_seat(uuid, uuid, uuid) from public;
grant execute on function public.reassign_seat(uuid, uuid, uuid) to authenticated;
