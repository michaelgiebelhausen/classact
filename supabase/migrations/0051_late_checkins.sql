-- Historical attendance claims stay separate until an actual neighbor confirms.
create table public.late_checkin_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  -- Explicit classroom replacement already removes seat-linked check_ins.
  -- Remove the associated claims too rather than blocking that workflow or
  -- retaining invitations that could recreate attendance against old seats.
  seat_id uuid not null references public.seats(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','confirmed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique(session_id, enrollment_id)
);
create table public.late_checkin_witnesses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.late_checkin_requests(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  response text check (response in ('confirm','not_present','unsure')),
  responded_at timestamptz,
  emailed_at timestamptz,
  email_claimed_at timestamptz,
  unique(request_id, enrollment_id)
);
create index late_checkin_witness_enrollment on public.late_checkin_witnesses(enrollment_id);
alter table public.late_checkin_requests enable row level security;
alter table public.late_checkin_witnesses enable row level security;
-- Reads are assembled server-side after course membership checks. No direct
-- client writes: both mutations below enforce identities inside the transaction.

create function public.request_late_checkin(p_session uuid, p_seat uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s public.class_sessions; c public.courses; e public.enrollments;
  seat public.seats; request_id uuid;
begin
  select * into s from class_sessions where id = p_session for update;
  select * into c from courses where id = s.course_id;
  if s.id is null or s.session_date >= (now() at time zone coalesce(c.timezone, 'UTC'))::date then
    raise exception 'Choose a past class session.';
  end if;
  select * into e from enrollments where course_id = s.course_id
    and profile_id = auth.uid() and status = 'active' order by created_at limit 1;
  if e.id is null then raise exception 'Active course enrollment required.'; end if;
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
      -- A late claim cannot become another late claim's supporting evidence.
      and not exists(select 1 from late_checkin_requests prior
        where prior.session_id = s.id and prior.enrollment_id = ci.enrollment_id)
    on conflict do nothing;
  if not found then raise exception 'No recorded neighbors are available to vouch for this seat.'; end if;
  return request_id;
end;
$$;

create function public.respond_late_checkin(p_request uuid, p_response text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.late_checkin_requests; witness_id uuid;
begin
  if p_response not in ('confirm','not_present','unsure') or p_response is null then
    raise exception 'Choose a valid response.';
  end if;
  select * into r from late_checkin_requests where id = p_request for update;
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
  update late_checkin_witnesses set response = p_response, responded_at = now() where id = witness_id;
  if p_response = 'confirm' then
    -- Do not replace an attendance record or displace someone else's seat.
    insert into check_ins(session_id, enrollment_id, seat_id, verified, is_new_seat)
      values(r.session_id, r.enrollment_id, r.seat_id, true, false)
      on conflict(session_id, enrollment_id) do nothing;
    update late_checkin_requests set status = 'confirmed', confirmed_at = now() where id = r.id;
  end if;
end;
$$;
revoke all on function public.request_late_checkin(uuid, uuid) from public, anon;
revoke all on function public.respond_late_checkin(uuid, text) from public, anon;
grant execute on function public.request_late_checkin(uuid, uuid) to authenticated;
grant execute on function public.respond_late_checkin(uuid, text) to authenticated;
