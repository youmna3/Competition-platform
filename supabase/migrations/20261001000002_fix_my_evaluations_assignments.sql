-- My Evaluations is scoped by the authenticated user's assignment UUID, not
-- by account role. This keeps each evaluator isolated while allowing an
-- assigned administrator (or future role) to evaluate as intended.

create or replace function public.judge_assignment_page(
  p_filters jsonb default '{}'::jsonb,
  p_page int default 1,
  p_page_size int default 20
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_size int:=public._page_size(p_page_size);
  v_offset int:=(greatest(p_page,1)-1)*public._page_size(p_page_size);
  v_q text:=lower(btrim(coalesce(p_filters->>'search','')));
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_approved_user() then
    raise exception 'Approved evaluator access required' using errcode='42501';
  end if;
  with filtered as materialized (
    select t.*,l.label level_label,g.name governorate_name,
      e.id evaluation_id,e.status evaluation_status,
      e.updated_at evaluation_updated_at,e.submitted_at
    from public.team_judges tj
    join public.teams t on t.id=tj.team_id
    join public.levels l on l.code=t.level_code
    join public.governorates g on g.code=t.governorate_code
    left join public.evaluations e
      on e.team_id=t.id and e.judge_id=auth.uid()
    where tj.judge_id=auth.uid()
      and (v_q='' or lower(t.team_code||' '||t.name||' '||t.project_name) like '%'||v_q||'%')
      and (coalesce(p_filters->>'organization','')='' or t.organization::text=p_filters->>'organization')
      and (coalesce(p_filters->>'level','')='' or t.level_code=p_filters->>'level')
      and (coalesce(p_filters->>'governorate','')='' or t.governorate_code=p_filters->>'governorate')
      and (coalesce(p_filters->>'competition','')='' or l.competition_code=p_filters->>'competition')
      and (coalesce(p_filters->>'status','')='' or
        case when e.id is null then 'not_started' when e.status='submitted' then 'submitted' else 'in_progress' end=p_filters->>'status')
  ), paged as (
    select * from filtered order by lower(team_code),id offset v_offset limit v_size
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.judge_assignment_page(jsonb,int,int) from public,anon,authenticated;
grant execute on function public.judge_assignment_page(jsonb,int,int) to authenticated;

create or replace function public.judge_dashboard_summary()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_approved_user() then
    raise exception 'Approved evaluator access required' using errcode='42501';
  end if;
  with rows as materialized (
    select l.organization,l.competition_code,e.status
    from public.team_judges tj
    join public.teams t on t.id=tj.team_id
    join public.levels l on l.code=t.level_code
    left join public.evaluations e
      on e.team_id=t.id and e.judge_id=auth.uid()
    where tj.judge_id=auth.uid()
  )
  select jsonb_build_object(
    'total',(select count(*) from rows),
    'submitted',(select count(*) from rows where status='submitted'),
    'groups',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select organization,competition_code,count(*)::int total,
        count(*) filter(where status='submitted')::int submitted
      from rows group by organization,competition_code
    ) x),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.judge_dashboard_summary() from public,anon,authenticated;
grant execute on function public.judge_dashboard_summary() to authenticated;

