-- New projects use contribution agreements; existing task records stay intact.
alter table public.projects add column mode text not null default 'tasks' check (mode in ('tasks','contribution'));
alter table public.projects alter column mode set default 'contribution';
alter table public.projects add column brief text not null default '';

create table public.contribution_agreements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  roster jsonb not null, shares jsonb not null,
  confirmations uuid[] not null default '{}', confirmed_at timestamptz,
  note text not null default '', created_at timestamptz not null default clock_timestamp()
);
create index contribution_agreements_team on public.contribution_agreements(team_id, created_at);
create table public.contribution_checkpoints (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null, deadline timestamptz not null,
  roster jsonb not null,
  agreement_id uuid not null references public.contribution_agreements(id),
  created_at timestamptz not null default clock_timestamp(),
  deadline_history jsonb not null default '[]'
);
create index contribution_checkpoints_team on public.contribution_checkpoints(team_id);
create table public.contribution_responses (
  checkpoint_id uuid not null references public.contribution_checkpoints(id) on delete cascade,
  respondent_id uuid not null, respondent_profile_id uuid not null,
  course_id uuid not null references public.courses(id) on delete cascade,
  actual jsonb, credit jsonb, declined boolean not null default false,
  explanation text not null default '', help_requested boolean not null default false,
  submitted_at timestamptz, revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(checkpoint_id, respondent_id)
);
create index contribution_responses_owner on public.contribution_responses(respondent_profile_id);
alter table public.contribution_agreements enable row level security;
alter table public.contribution_checkpoints enable row level security;
alter table public.contribution_responses enable row level security;
create policy contribution_agreements_read on public.contribution_agreements for select to authenticated using (
  public.is_course_professor(course_id) or public.is_team_member(team_id)
  or exists(select 1 from jsonb_array_elements(roster) r where r->>'profile_id' = auth.uid()::text)
);
create policy contribution_checkpoints_read on public.contribution_checkpoints for select to authenticated using (
  public.is_course_professor(course_id)
  or exists(select 1 from jsonb_array_elements(roster) r where r->>'profile_id' = auth.uid()::text)
);
-- Faculty only read explicit submissions, never students' unfinished drafts.
create policy contribution_responses_read on public.contribution_responses for select to authenticated using (
  respondent_profile_id = auth.uid() or (submitted_at is not null and public.is_course_professor(course_id))
);
-- No direct write policies: the transaction below owns all mutations.
revoke all on public.contribution_agreements, public.contribution_checkpoints, public.contribution_responses from anon;
revoke insert, update, delete on public.contribution_agreements, public.contribution_checkpoints, public.contribution_responses from authenticated;
grant select on public.contribution_agreements, public.contribution_checkpoints, public.contribution_responses to authenticated;

create function public.valid_contribution_allocation(v jsonb, roster jsonb)
returns boolean language sql immutable set search_path = public as $$
  select case when jsonb_typeof(v) <> 'object' or v is null then false else
    (select count(*) from jsonb_object_keys(v)) = jsonb_array_length(roster)
    and not exists(select 1 from jsonb_array_elements(roster) r
      where not coalesce(jsonb_typeof(v->(r->>'id')) = 'number'
        and (v->>(r->>'id'))::numeric between 0 and 10000
        and trunc((v->>(r->>'id'))::numeric) = (v->>(r->>'id'))::numeric, false))
    and (select sum(value::numeric) from jsonb_each_text(v)) = 10000 end;
$$;

-- Serialize roster edits with agreement confirmations/checkpoint snapshots.
create function public.contribution_membership_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t project_teams; e enrollments;
begin
  if TG_OP = 'UPDATE' then raise exception 'Leave and rejoin to change membership.'; end if;
  select * into t from project_teams where id = case when TG_OP = 'DELETE' then OLD.team_id else NEW.team_id end for update;
  if TG_OP = 'INSERT' then
    select * into e from enrollments where id = NEW.enrollment_id;
    if e.course_id <> t.course_id or NEW.project_id <> t.project_id or e.status <> 'active' then
      raise exception 'Membership must match the active course roster.';
    end if;
    return NEW;
  end if;
  return OLD;
end; $$;
create trigger contribution_membership_guard before insert or update or delete on public.project_team_members
for each row execute function public.contribution_membership_guard();

-- Old team policies permit team members to edit their contract. They must not
-- move that team (and its immutable snapshots) to a different course/project.
create function public.contribution_team_scope_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if NEW.course_id <> OLD.course_id or NEW.project_id <> OLD.project_id then
    raise exception 'A team cannot move between courses or projects.';
  end if;
  return NEW;
end; $$;
create trigger contribution_team_scope_guard before update on public.project_teams
for each row execute function public.contribution_team_scope_guard();

-- Match the course directory's class-visible naming rule before storing a
-- snapshot: a chosen name wins, an email is never a display-name fallback.
create function public.contribution_display_name(roster_name text, profile_name text)
returns text language sql immutable set search_path = public as $$
  select case
    when nullif(btrim(profile_name),'') is not null and position('@' in profile_name) = 0 then btrim(profile_name)
    when position('@' in coalesce(roster_name,'')) > 0 then split_part(btrim(roster_name),'@',1)
    else coalesce(nullif(btrim(roster_name),''),'Team member')
  end;
$$;

-- Names and presentation order are mutable; enrollment/account identities are
-- the consent boundary. Historical snapshot names remain untouched.
create function public.contribution_roster_identity(roster jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(r->>'id',r->>'profile_id') order by r->>'id'),'[]')
  from jsonb_array_elements(roster) r;
$$;

create function public.contribution_command(p_team uuid, p_action text, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  t project_teams; p projects; a contribution_agreements; cp contribution_checkpoints;
  roster_now jsonb; eid uuid; professor boolean; existing contribution_responses;
  actual jsonb; credit jsonb; declined boolean; explanation text; deadline_value timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into t from project_teams where id = p_team for update;
  select * into p from projects where id = t.project_id;
  if t.id is null or p.mode <> 'contribution' or t.course_id <> p.course_id then raise exception 'Contribution team not found.'; end if;
  professor := public.is_course_professor(t.course_id);
  select e.id into eid from project_team_members m join enrollments e on e.id = m.enrollment_id
    where m.team_id = t.id and e.profile_id = auth.uid() and e.status = 'active' and e.course_id = t.course_id;
  if not professor and (eid is null or p.status <> 'open') then raise exception 'Active membership in an open project required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'profile_id',e.profile_id,'name',
    public.contribution_display_name(e.roster_name, pr.full_name)) order by m.created_at, m.id),'[]') into roster_now
    from project_team_members m join enrollments e on e.id = m.enrollment_id
    left join profiles pr on pr.id = e.profile_id where m.team_id = t.id;

  if p_action = 'contract' then
    if eid is null or length(trim(coalesce(p_data->>'text',''))) = 0 then raise exception 'A team member must provide the contract text.'; end if;
    update project_teams set contract_text = left(trim(p_data->>'text'),20000) where id = t.id;
    delete from team_contract_signatures where team_id = t.id;
  elsif p_action = 'sign-contract' then
    if eid is null then raise exception 'Only a team member can sign.'; end if;
    if t.contract_text <> coalesce(p_data->>'text','') then raise exception 'The contract changed. Read it again before signing.'; end if;
    insert into team_contract_signatures(team_id,enrollment_id) values(t.id,eid) on conflict do nothing;
  elsif p_action = 'propose' then
    if eid is null then raise exception 'Only team members propose shares.'; end if;
    -- Optimistic latest-version check stops stale concurrent proposals.
    select * into a from contribution_agreements where team_id = t.id order by created_at desc, id desc limit 1;
    if coalesce(a.id::text,'') <> coalesce(p_data->>'previous','') then raise exception 'Agreement changed. Refresh and review it.'; end if;
    if not public.valid_contribution_allocation(p_data->'shares',roster_now) then raise exception 'Shares must include every member and total 100 percent.'; end if;
    insert into contribution_agreements(team_id,course_id,roster,shares,note)
      values(t.id,t.course_id,roster_now,p_data->'shares',left(coalesce(p_data->>'note',''),2000));
  elsif p_action = 'confirm' then
    select * into a from contribution_agreements where team_id = t.id order by created_at desc, id desc limit 1;
    if eid is null or a.id is null or a.id::text is distinct from p_data->>'id' then raise exception 'Review the latest proposal first.'; end if;
    if public.contribution_roster_identity(a.roster) is distinct from public.contribution_roster_identity(roster_now) then raise exception 'Team membership changed. Propose a new agreement.'; end if;
    if not eid = any(a.confirmations) then a.confirmations := array_append(a.confirmations,eid); end if;
    update contribution_agreements set confirmations = a.confirmations,
      confirmed_at = case when cardinality(a.confirmations) = jsonb_array_length(a.roster) then coalesce(a.confirmed_at,clock_timestamp()) else null end
      where id = a.id;
  elsif p_action = 'checkpoint' then
    if not professor then raise exception 'Only the instructor opens checkpoints.'; end if;
    select * into a from contribution_agreements where team_id = t.id and confirmed_at is not null order by created_at desc, id desc limit 1;
    if a.id is null or public.contribution_roster_identity(a.roster) is distinct from public.contribution_roster_identity(roster_now) then raise exception 'Confirm an agreement for the current roster first.'; end if;
    deadline_value := (p_data->>'deadline')::timestamptz;
    if deadline_value is null or deadline_value <= clock_timestamp() or not isfinite(deadline_value) or length(trim(coalesce(p_data->>'title',''))) = 0 then raise exception 'Give the checkpoint a title and a future deadline.'; end if;
    insert into contribution_checkpoints(team_id,course_id,title,deadline,roster,agreement_id)
      values(t.id,t.course_id,left(trim(p_data->>'title'),200),deadline_value,roster_now,a.id);
  elsif p_action = 'reopen' then
    if not professor then raise exception 'Only the instructor changes deadlines.'; end if;
    deadline_value := (p_data->>'deadline')::timestamptz;
    if deadline_value is null or deadline_value <= clock_timestamp() or not isfinite(deadline_value) then raise exception 'Choose a future deadline.'; end if;
    update contribution_checkpoints set deadline = deadline_value,
      deadline_history = deadline_history || jsonb_build_array(jsonb_build_object('previous',deadline,'next',deadline_value,'at',clock_timestamp(),'by',auth.uid()))
      where id = (p_data->>'id')::uuid and team_id = t.id;
    if not found then raise exception 'Checkpoint not found.'; end if;
  elsif p_action = 'save' then
    select * into cp from contribution_checkpoints where id = (p_data->>'id')::uuid and team_id = t.id for update;
    if cp.id is null or clock_timestamp() >= cp.deadline then raise exception 'This checkpoint is closed. Ask the instructor to reopen it.'; end if;
    if not exists(select 1 from jsonb_array_elements(cp.roster) r where r->>'id' = eid::text and r->>'profile_id' = auth.uid()::text) then raise exception 'You are not on this checkpoint roster.'; end if;
    select * into existing from contribution_responses where checkpoint_id = cp.id and respondent_id = eid;
    if coalesce(existing.revision,0) <> coalesce((p_data->>'revision')::int,0) then raise exception 'Response changed in another tab. Refresh before saving.'; end if;
    actual := p_data->'actual'; credit := p_data->'credit'; declined := coalesce((p_data->>'declined')::boolean,false);
    explanation := left(trim(coalesce(p_data->>'explanation','')),4000);
    if not declined then
      if not public.valid_contribution_allocation(actual,cp.roster) or not public.valid_contribution_allocation(credit,cp.roster) then raise exception 'Both charts must include the checkpoint roster and total 100.'; end if;
      if (coalesce((p_data->>'submit')::boolean,false) or existing.submitted_at is not null) and length(explanation) < 3 and exists(
        select 1 from jsonb_each_text(actual) x where x.value::int = 0 or abs(x.value::int - (credit->>x.key)::int) > 100
      ) then raise exception 'Explain zero contribution or a credit difference greater than one point.'; end if;
    else actual := null; credit := null; end if;
    -- A submitted response stays submitted when edited; saving cannot hide it.
    insert into contribution_responses(checkpoint_id,respondent_id,respondent_profile_id,course_id,actual,credit,declined,explanation,help_requested,submitted_at,revision)
      values(cp.id,eid,auth.uid(),t.course_id,actual,credit,declined,explanation,coalesce((p_data->>'help')::boolean,false),
        case when coalesce((p_data->>'submit')::boolean,false) or existing.submitted_at is not null then clock_timestamp() end,coalesce(existing.revision,0)+1)
      on conflict(checkpoint_id,respondent_id) do update set actual=excluded.actual,credit=excluded.credit,declined=excluded.declined,
        explanation=excluded.explanation,help_requested=excluded.help_requested,submitted_at=excluded.submitted_at,revision=excluded.revision,updated_at=clock_timestamp();
  else raise exception 'Unknown contribution action.';
  end if;
end; $$;
revoke all on function public.contribution_command(uuid,text,jsonb) from public, anon;
grant execute on function public.contribution_command(uuid,text,jsonb) to authenticated;
