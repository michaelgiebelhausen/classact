-- Attendance recovery and date policy. All original records are retained.
create table public.attendance_exclusions (
 course_id uuid not null references public.courses(id) on delete cascade,
 session_date date not null,
 reason text not null default '' check(length(reason)<=200),
 updated_at timestamptz not null default now(),
 primary key(course_id,session_date)
);
alter table public.attendance_exclusions enable row level security;
create policy attendance_exclusions_read on public.attendance_exclusions for select to authenticated using(is_course_member(course_id));
-- Writes only through the owner-authorized RPC below.
alter table public.class_sessions add column attendance_required boolean not null default true;
alter table public.late_checkin_requests add column pledged_at timestamptz, add column pledge_text text;
alter table public.late_checkin_witnesses add column pledge_text text;
alter table public.absences add column assessment_pending boolean not null default false;

create function public.sync_session_attendance_policy() returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- Inserts must serialize with date policy edits. Updates already hold the
 -- session row: never acquire the course lock in the opposite order.
 if tg_op='INSERT' then
  perform 1 from courses where id=new.course_id for update;
 elsif new.course_id is distinct from old.course_id or new.session_date is distinct from old.session_date then
  raise exception 'Session course and date cannot be changed.';
 end if;
 new.attendance_required := not exists(select 1 from attendance_exclusions where course_id=new.course_id and session_date=new.session_date);
 return new;
end $$;
create trigger session_attendance_policy before insert or update on public.class_sessions for each row execute function public.sync_session_attendance_policy();

create function public.set_attendance_exclusions(p_course uuid,p_dates date[],p_excluded boolean,p_reason text default '')
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from courses where id=p_course and professor_id=auth.uid() for update;
 if not found then raise exception 'Only the course instructor can change attendance days.'; end if;
 if p_excluded is null or coalesce(cardinality(p_dates),0) not between 1 and 400 or length(coalesce(p_reason,''))>200 or array_position(p_dates,null) is not null then raise exception 'Choose between 1 and 400 valid dates and a short reason.'; end if;
 if exists(select 1 from unnest(p_dates) d where d < date '2000-01-01' or d > date '2100-12-31') then raise exception 'Choose valid course dates.'; end if;
 if p_excluded then
  insert into attendance_exclusions(course_id,session_date,reason) select p_course,d,coalesce(p_reason,'') from (select distinct unnest(p_dates) d) dates
  on conflict(course_id,session_date) do update set reason=excluded.reason,updated_at=now();
 else delete from attendance_exclusions where course_id=p_course and session_date=any(p_dates);
 end if;
 update class_sessions set attendance_required=not p_excluded where course_id=p_course and session_date=any(p_dates);
end $$;

create function public.assert_attendance_recovery(p_session uuid,p_enrollment uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.class_sessions;
begin
 select * into s from class_sessions where id=p_session;
 if s.id is null or not s.attendance_required then raise exception 'Check-in is not required for this date.'; end if;
 if exists(select 1 from absences where enrollment_id=p_enrollment and course_id=s.course_id and absence_date=s.session_date) then
  raise exception 'You have reported an absence for this date. See your absence request instead.';
 end if;
end $$;

-- Protect direct check-in inserts as well as recovery RPCs.
create function public.guard_attendance_insert() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' then
  if new.session_id is distinct from old.session_id or new.enrollment_id is distinct from old.enrollment_id then raise exception 'Attendance identity cannot be changed.'; end if;
  return new;
 end if;
 perform 1 from courses where id=(select course_id from class_sessions where id=new.session_id) for update;
 perform assert_attendance_recovery(new.session_id,new.enrollment_id);
 return new;
end $$;
create trigger attendance_insert_guard before insert or update of session_id,enrollment_id on public.check_ins for each row execute function public.guard_attendance_insert();
create or replace function public.request_late_checkin(p_session uuid, p_seat uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s public.class_sessions; c public.courses; e public.enrollments;
  seat public.seats; request_id uuid;
begin
  select * into c from courses where id = (select course_id from class_sessions where id=p_session) for update;
  select * into s from class_sessions where id = p_session for update;
  select * into c from courses where id = s.course_id;
  if s.id is null or s.session_date >= (now() at time zone coalesce(c.timezone, 'UTC'))::date then
    raise exception 'Choose a past class session.';
  end if;
  select * into e from enrollments where course_id = s.course_id
    and profile_id = auth.uid() and status = 'active' order by created_at limit 1;
  if e.id is null then raise exception 'Active course enrollment required.'; end if;
  perform assert_attendance_recovery(s.id,e.id);
  if exists(select 1 from check_ins where session_id = s.id and enrollment_id = e.id) then
    raise exception 'You already have attendance for this class.';
  end if;
  select * into seat from seats where id = p_seat and course_id = s.course_id;
  if seat.id is null then raise exception 'Choose a seat in this classroom.'; end if;
  if exists(select 1 from check_ins where session_id = s.id and seat_id = seat.id) then
    raise exception 'That seat was recorded as occupied. Choose the seat you actually used.';
  end if;
  -- One claim per student/session, including concurrent submissions. Repeated
  -- submissions cannot nominate a new pair or send another round of email.
  insert into late_checkin_requests(session_id, enrollment_id, seat_id)
    values(s.id, e.id, seat.id) returning id into request_id;
  insert into late_checkin_witnesses(request_id, enrollment_id)
    select request_id, ci.enrollment_id from check_ins ci
    join seats neighbor on neighbor.id = ci.seat_id and neighbor.course_id = s.course_id
    join enrollments witness on witness.id = ci.enrollment_id
    where ci.session_id = s.id and ci.enrollment_id <> e.id
      and witness.course_id = s.course_id and witness.status = 'active'
      and witness.profile_id is not null and witness.profile_id <> auth.uid()
      and neighbor.label in (seat.neighbors->>'left', seat.neighbors->>'right')
      -- A personal pledge qualifies its signer for this session only.
      and not exists(select 1 from late_checkin_requests prior
        where prior.session_id = s.id and prior.enrollment_id = ci.enrollment_id and prior.pledged_at is null)
    on conflict do nothing;
  if not found then raise exception 'No recorded neighbors are available to vouch for this seat.'; end if;
  return request_id;
end;
$$;

drop function public.respond_late_checkin(uuid,text);
create function public.respond_late_checkin(p_request uuid, p_response text, p_pledge boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r public.late_checkin_requests; witness_id uuid;
begin
  if p_response not in ('confirm','not_present','unsure') or p_response is null then
    raise exception 'Choose a valid response.';
  end if;
  perform 1 from courses where id=(select cs.course_id from class_sessions cs join late_checkin_requests req on req.session_id=cs.id where req.id=p_request) for update;
  select * into r from late_checkin_requests where id = p_request for update;
  perform assert_attendance_recovery(r.session_id,r.enrollment_id);
  if p_response='confirm' and p_pledge is distinct from true then raise exception 'Affirm the university academic integrity pledge first.'; end if;
  select w.id into witness_id from late_checkin_witnesses w
    join enrollments e on e.id = w.enrollment_id
    where w.request_id = r.id and e.profile_id = auth.uid() and e.status = 'active'
      and w.response is null;
  if witness_id is null then raise exception 'This request is not awaiting your response.'; end if;
  if r.status = 'confirmed' then return; end if;
  if p_response = 'confirm' and exists(select 1 from check_ins
    where session_id = r.session_id and seat_id = r.seat_id and enrollment_id <> r.enrollment_id) then
    raise exception 'That seat now has another attendance record. This claim cannot be confirmed.';
  end if;
  update late_checkin_witnesses set response = p_response, responded_at = now(), pledge_text = case when p_response='confirm' then 'I personally saw this classmate in class on this date. I understand that knowingly submitting false information violates the university’s academic integrity expectations and could subject me to university academic integrity proceedings.' else null end where id = witness_id;
  if p_response = 'confirm' then
    -- Do not replace an attendance record or displace someone else's seat.
    insert into check_ins(session_id, enrollment_id, seat_id, verified, is_new_seat)
      values(r.session_id, r.enrollment_id, r.seat_id, true, false)
      on conflict(session_id, enrollment_id) do nothing;
    update late_checkin_requests set status = 'confirmed', confirmed_at = now() where id = r.id;
  end if;
end;
$$;

create function public.pledge_late_checkin(p_session uuid,p_seat uuid,p_pledge boolean)
returns void language plpgsql security definer set search_path=public as $$
declare s public.class_sessions; c public.courses; e public.enrollments; seat public.seats;
begin
 if p_pledge is distinct from true then raise exception 'Affirm the university academic integrity pledge first.'; end if;
 select * into c from courses where id=(select course_id from class_sessions where id=p_session) for update;
 select * into s from class_sessions where id=p_session for update;
 if s.id is null or s.session_date >= (now() at time zone coalesce(c.timezone,'UTC'))::date then raise exception 'Choose a past class session.'; end if;
 select * into e from enrollments where course_id=s.course_id and profile_id=auth.uid() and status='active' order by created_at limit 1;
 if e.id is null then raise exception 'Active course enrollment required.'; end if;
 perform assert_attendance_recovery(s.id,e.id);
 if exists(select 1 from check_ins where session_id=s.id and enrollment_id=e.id) then raise exception 'You already have attendance for this class.'; end if;
 select * into seat from seats where id=p_seat and course_id=s.course_id;
 if seat.id is null then raise exception 'Choose a seat in this classroom.'; end if;
 if exists(select 1 from check_ins where session_id=s.id and seat_id=seat.id) then raise exception 'That seat was recorded as occupied.'; end if;
 if exists(select 1 from check_ins ci join seats n on n.id=ci.seat_id join enrollments w on w.id=ci.enrollment_id
  where ci.session_id=s.id and w.course_id=s.course_id and w.status='active' and w.profile_id is not null and w.profile_id<>auth.uid()
  and n.label in (seat.neighbors->>'left',seat.neighbors->>'right')
  and not exists(select 1 from late_checkin_requests r where r.session_id=s.id and r.enrollment_id=ci.enrollment_id and r.pledged_at is null)) then
  raise exception 'A recorded neighbor is available. Ask your neighbors to vouch first.';
 end if;
 insert into late_checkin_requests(session_id,enrollment_id,seat_id,status,confirmed_at,pledged_at,pledge_text)
 values(s.id,e.id,seat.id,'confirmed',now(),now(),'I attended this class on this date and sat in this seat. I understand that knowingly submitting false information violates the university’s academic integrity expectations and could subject me to university academic integrity proceedings.');
 insert into check_ins(session_id,enrollment_id,seat_id,verified,is_new_seat) values(s.id,e.id,seat.id,true,false);
end $$;
revoke all on function public.assert_attendance_recovery(uuid,uuid), public.sync_session_attendance_policy(), public.guard_attendance_insert() from public,anon,authenticated;
revoke all on function public.set_attendance_exclusions(uuid,date[],boolean,text), public.pledge_late_checkin(uuid,uuid,boolean), public.respond_late_checkin(uuid,text,boolean) from public,anon;
grant execute on function public.set_attendance_exclusions(uuid,date[],boolean,text), public.pledge_late_checkin(uuid,uuid,boolean), public.respond_late_checkin(uuid,text,boolean) to authenticated;
