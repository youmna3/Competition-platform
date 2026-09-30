-- Judge Progress is assignment-driven. Administrators and any future role may
-- evaluate teams, so role must never determine inclusion in this report.

create or replace function public.admin_evaluator_progress_page(
  p_filters jsonb default '{}'::jsonb,
  p_page int default 1,
  p_page_size int default 20
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_size int := public._page_size(p_page_size);
  v_offset int := (greatest(p_page,1)-1)*public._page_size(p_page_size);
  v_q text := lower(btrim(coalesce(p_filters->>'search','')));
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;

  with assignment_rows as materialized (
    select p.id,p.email,p.full_name,p.role,t.id team_id,t.team_code,t.name team_name,
      t.project_name,t.organization,t.level_code,t.governorate_code,
      case when e.id is null then 'not_started'
           when e.status='submitted' then 'submitted'
           else 'in_progress' end evaluation_status
    from public.team_judges tj
    join public.profiles p on p.id=tj.judge_id
    join public.teams t on t.id=tj.team_id
    left join public.evaluations e on e.team_id=t.id and e.judge_id=p.id
    where (coalesce(p_filters->>'judge','')='' or p.id::text=p_filters->>'judge')
      and (coalesce(p_filters->>'organization','')='' or t.organization::text=p_filters->>'organization')
      and (coalesce(p_filters->>'level','')='' or t.level_code=p_filters->>'level')
      and (coalesce(p_filters->>'governorate','')='' or t.governorate_code=p_filters->>'governorate')
      and (coalesce(p_filters->>'status','')='' or
        case when e.id is null then 'not_started' when e.status='submitted' then 'submitted' else 'in_progress' end=p_filters->>'status')
      and (v_q='' or lower(p.full_name) like '%'||v_q||'%' or lower(p.email) like '%'||v_q||'%'
        or lower(t.team_code) like '%'||v_q||'%' or lower(t.name) like '%'||v_q||'%')
  ), filtered as materialized (
    select id,email,full_name,role,
      coalesce(array_agg(distinct organization::text),'{}') organizations,
      count(*)::int assigned,
      count(*) filter(where evaluation_status='submitted')::int completed,
      count(*) filter(where evaluation_status='in_progress')::int in_progress,
      count(*) filter(where evaluation_status='not_started')::int not_started
    from assignment_rows group by id,email,full_name,role
  ), paged as (
    select *,round(completed*100.0/assigned)::int completion_percentage
    from filtered order by lower(coalesce(full_name,email)),id
    offset v_offset limit v_size
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_evaluator_progress_page(jsonb,int,int) from public,anon,authenticated;
grant execute on function public.admin_evaluator_progress_page(jsonb,int,int) to authenticated;

create or replace function public.admin_assigned_evaluator_choices()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by lower(coalesce(x.full_name,x.email)),x.id),'[]'::jsonb)
    into v_result
  from (
    select distinct p.id,p.email,p.full_name,p.role
    from public.team_judges tj join public.profiles p on p.id=tj.judge_id
  ) x;
  return v_result;
end;
$$;

revoke all on function public.admin_assigned_evaluator_choices() from public,anon,authenticated;
grant execute on function public.admin_assigned_evaluator_choices() to authenticated;

create or replace function public.admin_progress_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  with per_evaluator as (
    select tj.judge_id,
      count(*)::int assigned,
      count(e.id) filter(where e.status='submitted')::int completed,
      count(e.id) filter(where e.status='draft')::int in_progress
    from public.team_judges tj
    left join public.evaluations e on e.team_id=tj.team_id and e.judge_id=tj.judge_id
    group by tj.judge_id
  ), waiting as (
    select count(distinct tj.team_id)::int teams_waiting
    from public.team_judges tj
    left join public.evaluations e on e.team_id=tj.team_id and e.judge_id=tj.judge_id
    where e.id is null or e.status<>'submitted'
  )
  select jsonb_build_object(
    'judges_not_started',count(*) filter(where completed=0 and in_progress=0),
    'judges_incomplete',count(*) filter(where completed<assigned),
    'judges_finished',count(*) filter(where completed=assigned),
    'teams_waiting',(select teams_waiting from waiting)
  ) into v_result from per_evaluator;
  return v_result;
end;
$$;

revoke all on function public.admin_progress_stats() from public,anon,authenticated;
grant execute on function public.admin_progress_stats() to authenticated;

