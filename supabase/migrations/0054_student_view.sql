-- Practice uses the instructor's existing identity with a STUDENT enrollment
-- in a separate course. The unloginable owner is created by the server's Auth
-- admin API. No live student records are copied. Migration before application.
alter table public.courses add column practice_source_id uuid references public.courses(id) on delete cascade;
alter table public.courses add column practice_instructor_id uuid references public.profiles(id) on delete cascade;
alter table public.courses add column practice_routes jsonb not null default '{}';
alter table public.courses add constraint practice_pair check ((practice_source_id is null) = (practice_instructor_id is null));
create unique index one_practice_per_course on public.courses(practice_source_id) where practice_source_id is not null;

-- Even service-role join/roster flows cannot admit real classmates to a practice course.
create function public.guard_practice_enrollment() returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid;
begin
  select practice_instructor_id into owner_id from courses where id=new.course_id;
  if owner_id is not null and (new.profile_id is distinct from owner_id) then
    raise exception 'Only the instructor may join this practice course.';
  end if;
  return new;
end $$;
create trigger guard_practice_enrollment before insert or update on public.enrollments for each row execute function public.guard_practice_enrollment();

-- Clients cannot manufacture practice flags or change their isolation boundary.
create function public.guard_practice_course() returns trigger language plpgsql set search_path=public as $$
begin
  if current_user not in ('postgres','service_role') and
     (new.practice_source_id is not null or (TG_OP='UPDATE' and old.practice_source_id is not null)) then
    raise exception 'Practice courses are managed by Student View.';
  end if;
  return new;
end $$;
create trigger guard_practice_course before insert or update on public.courses for each row execute function public.guard_practice_course();

create function public.create_practice_course(p_source uuid,p_instructor uuid,p_owner uuid,p_reset boolean default false,p_expected uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare c courses; dest uuid:=gen_random_uuid(); r record; l record; new_id uuid; lecture_copy uuid; exercise_copy uuid; group_copy uuid; ids jsonb:='{}'; seats_map jsonb:='{}';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_source::text,0));
  select * into c from courses where id=p_source and professor_id=p_instructor and practice_source_id is null;
  if not found then raise exception 'Only the current course owner can enter Student View.'; end if;
  if p_reset and not exists(select 1 from courses where id=p_expected and practice_source_id=p_source and practice_instructor_id=p_instructor and professor_id=p_owner) then raise exception 'Practice snapshot changed. Reopen Student View.'; end if;
  if exists(select 1 from courses where practice_source_id=p_source) then
    if not p_reset then raise exception 'A practice copy already exists.'; end if;
    if not exists(select 1 from courses where practice_source_id=p_source and practice_instructor_id=p_instructor and professor_id=p_owner) then raise exception 'Invalid practice reset.'; end if;
    delete from courses where practice_source_id=p_source;
  end if;
  if not exists(select 1 from auth.users where id=p_owner and raw_app_meta_data->>'practice_owner_for'=p_instructor::text) then raise exception 'Invalid practice owner.'; end if;
  insert into courses(id,professor_id,name,term,join_code,icebreaker_fields,room_id,meeting_days,meeting_start,meeting_end,timezone,auto_open,term_start,term_end,grading_defaults,participation_weights,attendance_policy,transcripts_downloadable,ta_enabled,syllabus_path,syllabus_title,syllabus_text,practice_source_id,practice_instructor_id)
  values(dest,p_owner,c.name,c.term,'P-'||dest::text,c.icebreaker_fields,c.room_id,c.meeting_days,c.meeting_start,c.meeting_end,c.timezone,c.auto_open,c.term_start,c.term_end,c.grading_defaults,c.participation_weights,c.attendance_policy,c.transcripts_downloadable,c.ta_enabled,c.syllabus_path,c.syllabus_title,c.syllabus_text,p_source,p_instructor);
  insert into enrollments(course_id,profile_id,roster_name,roster_email,status) values(dest,p_instructor,'Practice student','practice@invalid.example','active');
  for r in select * from seats where course_id=p_source loop
    new_id:=gen_random_uuid(); seats_map:=seats_map||jsonb_build_object(r.id::text,new_id);
    insert into seats(id,course_id,label,row_index,col_index,x,y,section,table_id,neighbors) values(new_id,dest,r.label,r.row_index,r.col_index,r.x,r.y,r.section,r.table_id,'{}');
  end loop;
  for r in select * from seats where course_id=p_source loop
    update seats set neighbors=coalesce((select jsonb_object_agg(key,seats_map->>value) from jsonb_each_text(r.neighbors) where seats_map ? value),'{}') where id=(seats_map->>r.id::text)::uuid;
  end loop;
  insert into class_sessions(course_id,session_date) values(dest,(now() at time zone coalesce(c.timezone,'UTC'))::date);
  for r in select * from assignments where course_id=p_source loop
    new_id:=gen_random_uuid(); ids:=ids||jsonb_build_object(r.id::text,new_id);
    insert into assignments(id,course_id,title,instructions,points,storage_path,deadline,peer_close_at,settings,state,published_at)
    values(new_id,dest,r.title,r.instructions,r.points,r.storage_path,r.deadline,r.peer_close_at,r.settings,r.state,r.published_at);
    insert into taste_files(assignment_id,course_id,enrollment_id,body,criteria,bar_statement,is_default_untouched)
    select new_id,dest,null,body,criteria,bar_statement,is_default_untouched from taste_files where assignment_id=r.id and enrollment_id is null;
    insert into rubric_themes(assignment_id,course_id,name,description,weight,position,provenance,items)
    select new_id,dest,name,description,weight,position,provenance,'[]'::jsonb from rubric_themes where assignment_id=r.id;
  end loop;
  for r in select * from projects where course_id=p_source and status='open' loop
    new_id:=gen_random_uuid(); ids:=ids||jsonb_build_object(r.id::text,new_id);
    insert into projects(id,course_id,title,storage_path,page_count,due_date,target_team_size,contract_text,status,mode,brief)
    values(new_id,dest,r.title,r.storage_path,r.page_count,r.due_date,r.target_team_size,r.contract_text,r.status,r.mode,r.brief);
    insert into project_tasks(project_id,course_id,title,description,estimated_minutes,position,source)
    select new_id,dest,title,description,estimated_minutes,position,source from project_tasks where project_id=r.id;
  end loop;
  for r in select * from lecture_decks where course_id=p_source loop
    new_id:=gen_random_uuid(); ids:=ids||jsonb_build_object(r.id::text,new_id);
    insert into lecture_decks(id,course_id,title,kind,storage_path,embed_url,page_count,position,reading_path,reading_title,transcript_path,transcript_title)
    values(new_id,dest,r.title,r.kind,r.storage_path,r.embed_url,r.page_count,r.position,r.reading_path,r.reading_title,r.transcript_path,r.transcript_title);
    for l in select * from lectures where deck_id=r.id and ended_at is null loop
      insert into lectures(course_id,deck_id,current_page,started_at) values(dest,new_id,l.current_page,now()) returning id into lecture_copy;
      -- Only the student-visible question snapshot, never classmates' answers,
      -- vote totals, discussion pairs or the instructor's question bank.
      insert into poll_rounds(lecture_id,course_id,prompt,options,stage,correct_indices,revealed_at)
      select lecture_copy,dest,prompt,options,stage,correct_indices,revealed_at from poll_rounds where lecture_id=l.id and stage<>'closed';
    end loop;
  end loop;
  for r in select * from exercise_rounds where course_id=p_source and stage='open' loop
    insert into exercise_rounds(course_id,prompt,stage) values(dest,r.prompt,'open') returning id into exercise_copy;
    insert into exercise_groups(round_id,course_id,label) values(exercise_copy,dest,'Practice group') returning id into group_copy;
    insert into exercise_group_members(group_id,course_id,enrollment_id) select group_copy,dest,id from enrollments where course_id=dest;
    insert into exercise_responses(group_id,round_id,course_id,content) values(group_copy,exercise_copy,dest,'');
  end loop;
  update courses set practice_routes=ids where id=dest;
  return dest;
end $$;
revoke all on function public.create_practice_course(uuid,uuid,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.create_practice_course(uuid,uuid,uuid,boolean,uuid) to service_role;

-- Source material paths are shared read-only. The instructor already has
-- permission to read these files; practice adds no source storage policy.
