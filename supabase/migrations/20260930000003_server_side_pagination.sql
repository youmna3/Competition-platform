-- Counted, filtered server-side pages for large application lists. These
-- functions derive reporting fields from existing records and store no copies.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public._page_size(p_size int)
returns int language sql immutable as $$
  select case when p_size in (20, 50, 100) then p_size else 20 end
$$;
revoke all on function public._page_size(int) from public, anon, authenticated;

create or replace function public.admin_list_page(
  p_kind text,
  p_filters jsonb default '{}'::jsonb,
  p_page int default 1,
  p_page_size int default 20
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_size int := public._page_size(p_page_size);
  v_offset int := (greatest(p_page, 1) - 1) * public._page_size(p_page_size);
  v_result jsonb;
  v_q text := lower(btrim(coalesce(p_filters->>'search', '')));
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_kind = 'teams' then
    with filtered as materialized (
      select t.*,
        coalesce((select jsonb_agg(tj.judge_id order by tj.assigned_at) from public.team_judges tj where tj.team_id=t.id), '[]'::jsonb) judge_ids,
        count(tj.judge_id)::int judges_required,
        count(e.id) filter (where e.status='submitted')::int judges_submitted
      from public.teams t
      join public.levels l on l.code=t.level_code
      left join public.team_judges tj on tj.team_id=t.id
      left join public.evaluations e on e.team_id=t.id and e.judge_id=tj.judge_id
      where (v_q='' or lower(t.team_code||' '||t.name||' '||t.project_name) like '%'||v_q||'%')
        and (coalesce(p_filters->>'organization','')='' or t.organization::text=p_filters->>'organization')
        and (coalesce(p_filters->>'level','')='' or t.level_code=p_filters->>'level')
        and (coalesce(p_filters->>'governorate','')='' or t.governorate_code=p_filters->>'governorate')
      group by t.id
      having coalesce(p_filters->>'status','')=''
        or (p_filters->>'status'='unassigned' and count(tj.judge_id)=0)
        or (p_filters->>'status'='pending' and count(tj.judge_id)>0 and count(e.id) filter(where e.status='submitted')<count(tj.judge_id))
        or (p_filters->>'status'='complete' and count(tj.judge_id)>0 and count(e.id) filter(where e.status='submitted')=count(tj.judge_id))
    ), paged as (select * from filtered order by lower(team_code), id offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  elsif p_kind = 'judges' then
    with filtered as materialized (
      select p.*,
        count(tj.team_id)::int assigned,
        count(e.id) filter(where e.status='submitted')::int submitted,
        count(e.id) filter(where e.status='draft')::int drafts
      from public.profiles p
      left join public.team_judges tj on tj.judge_id=p.id
      left join public.evaluations e on e.team_id=tj.team_id and e.judge_id=p.id
      where (coalesce(p_filters->>'status','all')='all' or p.status::text=p_filters->>'status')
        and (v_q='' or lower(p.full_name||' '||p.email) like '%'||v_q||'%')
      group by p.id
    ), paged as (select * from filtered order by lower(coalesce(full_name,email)),id offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  elsif p_kind = 'invitations' then
    with filtered as materialized (
      select * from public.user_invitations i
      where v_q='' or lower(i.full_name||' '||i.email) like '%'||v_q||'%'
    ), paged as (select * from filtered order by invited_at desc,id desc offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  elsif p_kind = 'progress' then
    with assignment_rows as materialized (
      select p.id,p.email,p.full_name,t.id team_id,t.team_code,t.name team_name,t.project_name,t.organization,t.level_code,t.governorate_code,
        case when e.id is null then 'not_started' when e.status='submitted' then 'submitted' else 'in_progress' end evaluation_status
      from public.profiles p left join public.team_judges tj on tj.judge_id=p.id left join public.teams t on t.id=tj.team_id
      left join public.evaluations e on e.team_id=t.id and e.judge_id=p.id
      where p.role='judge'
        and (coalesce(p_filters->>'judge','')='' or p.id::text=p_filters->>'judge')
        and (coalesce(p_filters->>'organization','')='' or t.organization::text=p_filters->>'organization')
        and (coalesce(p_filters->>'level','')='' or t.level_code=p_filters->>'level')
        and (coalesce(p_filters->>'governorate','')='' or t.governorate_code=p_filters->>'governorate')
        and (coalesce(p_filters->>'status','')='' or (t.id is not null and case when e.id is null then 'not_started' when e.status='submitted' then 'submitted' else 'in_progress' end=p_filters->>'status'))
        and (v_q='' or lower(p.full_name) like '%'||v_q||'%' or lower(p.email) like '%'||v_q||'%' or lower(coalesce(t.team_code,'')) like '%'||v_q||'%' or lower(coalesce(t.name,'')) like '%'||v_q||'%')
    ), filtered as materialized (
      select id,email,full_name,coalesce(array_agg(distinct organization::text) filter(where team_id is not null),'{}') organizations,count(team_id)::int assigned,
        count(team_id) filter(where evaluation_status='submitted')::int completed,
        count(team_id) filter(where evaluation_status='in_progress')::int in_progress,
        count(team_id) filter(where evaluation_status='not_started')::int not_started
      from assignment_rows group by id,email,full_name
    ), paged as (select *,case when assigned=0 then 0 else round(completed*100.0/assigned)::int end completion_percentage from filtered order by lower(coalesce(full_name,email)),id offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  elsif p_kind = 'results' then
    with filtered as materialized (
      select * from public._team_results() r
      where (v_q='' or lower(r.team_code) like '%'||v_q||'%' or lower(r.team_name) like '%'||v_q||'%' or lower(r.project_name) like '%'||v_q||'%')
        and (coalesce(p_filters->>'competition','')='' or r.competition_code=p_filters->>'competition')
        and (coalesce(p_filters->>'governorate','')='' or r.governorate_code=p_filters->>'governorate')
        and (coalesce(p_filters->>'status','')='' or (p_filters->>'status'='complete' and r.is_complete) or (p_filters->>'status'='pending' and not r.is_complete and r.judges_required>0) or (p_filters->>'status'='unassigned' and r.judges_required=0))
        and (coalesce(p_filters->>'judge','')='' or exists(select 1 from public.team_judges tj where tj.team_id=r.team_id and tj.judge_id::text=p_filters->>'judge'))
    ), paged as (select * from filtered order by competition_sort,lower(team_code),team_id offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  elsif p_kind = 'progress_details' then
    with filtered as materialized (
      select t.*,l.label level_label,g.name governorate_name,e.id evaluation_id,e.status evaluation_status,e.updated_at evaluation_updated_at,e.submitted_at
      from public.team_judges tj join public.teams t on t.id=tj.team_id join public.levels l on l.code=t.level_code join public.governorates g on g.code=t.governorate_code
      left join public.evaluations e on e.team_id=t.id and e.judge_id=tj.judge_id
      where tj.judge_id::text=p_filters->>'judge'
        and (coalesce(p_filters->>'organization','')='' or t.organization::text=p_filters->>'organization')
        and (coalesce(p_filters->>'level','')='' or t.level_code=p_filters->>'level')
        and (coalesce(p_filters->>'governorate','')='' or t.governorate_code=p_filters->>'governorate')
        and (coalesce(p_filters->>'status','')='' or case when e.id is null then 'not_started' when e.status='submitted' then 'submitted' else 'in_progress' end=p_filters->>'status')
        and (v_q='' or lower(t.team_code||' '||t.name||' '||t.project_name) like '%'||v_q||'%')
    ), paged as (select * from filtered order by lower(team_code),id offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  elsif p_kind = 'audit' then
    with filtered as materialized (
      select a.* from public.audit_log a
      where (coalesce(p_filters->>'action','')='' or a.action like p_filters->>'action'||'%')
        and (coalesce(p_filters->>'team_id','')='' or a.team_id::text=p_filters->>'team_id')
        and (coalesce(p_filters->>'evaluation_id','')='' or a.evaluation_id::text=p_filters->>'evaluation_id')
        and (v_q='' or lower(a.action) like '%'||v_q||'%' or lower(coalesce(a.entity_id,'')) like '%'||v_q||'%')
    ), paged as (select * from filtered order by occurred_at desc,id desc offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  elsif p_kind = 'leaderboard' then
    with filtered as materialized (
      select * from public.get_leaderboard(nullif(p_filters->>'organization',''),nullif(p_filters->>'competition',''),nullif(p_filters->>'level',''),nullif(p_filters->>'governorate',''))
    ), paged as (select * from filtered order by competition_code,rank,lower(team_code),team_id offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  elsif p_kind = 'rubric_versions' then
    with filtered as materialized (select * from public.rubric_templates t where coalesce(p_filters->>'family','')='' or t.family_id=p_filters->>'family'),
    paged as (select * from filtered order by family_id,version desc,id offset v_offset limit v_size)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  else
    raise exception 'Unsupported page kind %', p_kind using errcode='22023';
  end if;
  return v_result;
end;
$$;

revoke all on function public.admin_list_page(text,jsonb,int,int) from public, anon, authenticated;
grant execute on function public.admin_list_page(text,jsonb,int,int) to authenticated;

create or replace function public.judge_assignment_page(
  p_filters jsonb default '{}'::jsonb,
  p_page int default 1,
  p_page_size int default 20
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_size int:=public._page_size(p_page_size);v_offset int:=(greatest(p_page,1)-1)*public._page_size(p_page_size);v_q text:=lower(btrim(coalesce(p_filters->>'search','')));v_result jsonb;
begin
  if not public.is_approved_user() or public.is_admin() then raise exception 'Approved judge access required' using errcode='42501'; end if;
  with filtered as materialized (
    select t.*,l.label level_label,g.name governorate_name,e.id evaluation_id,e.status evaluation_status,e.updated_at evaluation_updated_at,e.submitted_at
    from public.team_judges tj join public.teams t on t.id=tj.team_id join public.levels l on l.code=t.level_code join public.governorates g on g.code=t.governorate_code
    left join public.evaluations e on e.team_id=t.id and e.judge_id=auth.uid()
    where tj.judge_id=auth.uid()
      and (v_q='' or lower(t.team_code||' '||t.name||' '||t.project_name) like '%'||v_q||'%')
      and (coalesce(p_filters->>'organization','')='' or t.organization::text=p_filters->>'organization')
      and (coalesce(p_filters->>'level','')='' or t.level_code=p_filters->>'level')
      and (coalesce(p_filters->>'governorate','')='' or t.governorate_code=p_filters->>'governorate')
      and (coalesce(p_filters->>'competition','')='' or l.competition_code=p_filters->>'competition')
      and (coalesce(p_filters->>'status','')='' or case when e.id is null then 'not_started' when e.status='submitted' then 'submitted' else 'in_progress' end=p_filters->>'status')
  ), paged as (select * from filtered order by lower(team_code),id offset v_offset limit v_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into v_result;
  return v_result;
end;
$$;
revoke all on function public.judge_assignment_page(jsonb,int,int) from public, anon, authenticated;
grant execute on function public.judge_assignment_page(jsonb,int,int) to authenticated;

create or replace function public.judge_dashboard_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with rows as (
    select l.organization,l.competition_code,e.status
    from public.team_judges tj join public.teams t on t.id=tj.team_id join public.levels l on l.code=t.level_code
    left join public.evaluations e on e.team_id=t.id and e.judge_id=auth.uid()
    where tj.judge_id=auth.uid() and public.is_approved_user() and not public.is_admin()
  )
  select jsonb_build_object(
    'total',(select count(*) from rows),
    'submitted',(select count(*) from rows where status='submitted'),
    'groups',coalesce((select jsonb_agg(to_jsonb(x)) from (select organization,competition_code,count(*)::int total,count(*) filter(where status='submitted')::int submitted from rows group by organization,competition_code) x),'[]'::jsonb)
  )
$$;
revoke all on function public.judge_dashboard_summary() from public,anon,authenticated;
grant execute on function public.judge_dashboard_summary() to authenticated;

create or replace function public.admin_progress_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  with per_judge as (
    select p.id,count(tj.team_id)::int assigned,
      count(e.id) filter(where e.status='submitted')::int completed,
      count(e.id) filter(where e.status='draft')::int in_progress
    from public.profiles p
    left join public.team_judges tj on tj.judge_id=p.id
    left join public.evaluations e on e.team_id=tj.team_id and e.judge_id=p.id
    where p.role='judge'
    group by p.id
  ), waiting as (
    select count(distinct tj.team_id)::int teams_waiting
    from public.team_judges tj
    left join public.evaluations e on e.team_id=tj.team_id and e.judge_id=tj.judge_id
    where e.id is null or e.status<>'submitted'
  )
  select jsonb_build_object(
    'judges_not_started',count(*) filter(where assigned>0 and completed=0 and in_progress=0),
    'judges_incomplete',count(*) filter(where assigned>0 and completed<assigned),
    'judges_finished',count(*) filter(where assigned>0 and completed=assigned),
    'teams_waiting',(select teams_waiting from waiting)
  ) into v_result from per_judge;
  return v_result;
end;
$$;
revoke all on function public.admin_progress_stats() from public,anon,authenticated;
grant execute on function public.admin_progress_stats() to authenticated;

create index if not exists teams_search_idx on public.teams using gin (lower(team_code||' '||name||' '||project_name) extensions.gin_trgm_ops);
create index if not exists profiles_search_idx on public.profiles using gin (lower(full_name||' '||email) extensions.gin_trgm_ops);
create index if not exists audit_log_occurred_id_idx on public.audit_log (occurred_at desc,id desc);
create index if not exists audit_log_action_occurred_idx on public.audit_log (action text_pattern_ops,occurred_at desc);
create index if not exists profiles_status_name_idx on public.profiles (status,lower(full_name),id);
