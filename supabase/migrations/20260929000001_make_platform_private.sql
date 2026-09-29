-- Make every application data surface private. Authentication recovery and
-- invitation exchange remain Auth endpoints; application data requires an
-- approved, active profile.

-- Reference data previously used by the public leaderboard.
revoke all on public.governorates, public.competitions, public.levels, public.results_signal from anon;

drop policy if exists governorates_read on public.governorates;
create policy governorates_read on public.governorates for select to authenticated
  using ((select public.is_approved_user()));

drop policy if exists competitions_read on public.competitions;
create policy competitions_read on public.competitions for select to authenticated
  using ((select public.is_approved_user()));

drop policy if exists levels_read on public.levels;
create policy levels_read on public.levels for select to authenticated
  using ((select public.is_approved_user()));

drop policy if exists results_signal_read on public.results_signal;
create policy results_signal_read on public.results_signal for select to authenticated
  using ((select public.is_approved_user()));

-- Global and version-specific scale rows must not be visible to pending,
-- disabled or password-gated accounts.
drop policy if exists score_levels_read on public.score_levels;
create policy score_levels_read on public.score_levels for select to authenticated
  using ((select public.is_approved_user()));

drop policy if exists rubric_score_levels_read on public.rubric_score_levels;
create policy rubric_score_levels_read on public.rubric_score_levels for select to authenticated using (
  public.is_admin() or (
    public.is_approved_user() and exists (
      select 1 from public.teams t join public.team_judges tj on tj.team_id=t.id
      where t.template_id=rubric_score_levels.template_id and tj.judge_id=auth.uid()
    )
  )
);

-- Preserve assigned-rubric access, but require the judge account to remain
-- approved and active. Administrators retain complete rubric history access.
drop policy if exists rubric_templates_read on public.rubric_templates;
create policy rubric_templates_read on public.rubric_templates for select to authenticated using (
  public.is_admin() or (
    public.is_approved_user() and exists (
      select 1 from public.teams t join public.team_judges tj on tj.team_id=t.id
      where t.template_id=rubric_templates.id and tj.judge_id=auth.uid()
    )
  )
);

drop policy if exists rubric_sections_read on public.rubric_sections;
create policy rubric_sections_read on public.rubric_sections for select to authenticated using (
  public.is_admin() or (
    public.is_approved_user() and exists (
      select 1 from public.teams t join public.team_judges tj on tj.team_id=t.id
      where t.template_id=rubric_sections.template_id and tj.judge_id=auth.uid()
    )
  )
);

drop policy if exists rubric_criteria_read on public.rubric_criteria;
create policy rubric_criteria_read on public.rubric_criteria for select to authenticated using (
  public.is_admin() or (
    public.is_approved_user() and exists (
      select 1 from public.teams t join public.team_judges tj on tj.team_id=t.id
      where t.template_id=rubric_criteria.template_id and tj.judge_id=auth.uid()
    )
  )
);

-- Anonymous callers cannot invoke any identity or leaderboard helper.
revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_approved_user() from anon;
revoke execute on function public.is_assigned_judge(uuid) from anon;
revoke execute on function public.get_leaderboard(text,text,text,text) from anon;
revoke execute on function public.get_competitions() from anon;

create or replace function public.get_leaderboard(
  p_organization text default null,
  p_competition text default null,
  p_level text default null,
  p_governorate text default null
) returns table (
  rank int, team_id uuid, team_code text, team_name text, project_name text,
  organization public.organization_code, competition_code text, competition_label text,
  level_code text, level_label text, governorate_code text, governorate_name text,
  judges_submitted int, judges_required int, avg_core numeric, avg_bonus numeric,
  is_top boolean, is_tied boolean, is_published boolean
) language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean;
begin
  if not public.is_approved_user() then
    raise exception 'An approved active account is required' using errcode='42501';
  end if;
  v_admin := public.is_admin();
  return query
  with base as (
    select r.*, round(r.avg_core,6) as sort_core from public._team_results() r
    where r.is_complete
      and (v_admin or r.is_published)
      and (p_organization is null or r.organization::text=p_organization)
      and (p_competition is null or r.competition_code=p_competition)
      and (p_level is null or r.level_code=p_level)
      and (p_governorate is null or r.governorate_code=p_governorate)
  ), ranked as (
    select b.*,rank() over(partition by b.competition_code order by b.sort_core desc)::int as rnk,
      count(*) over(partition by b.competition_code,b.sort_core)::int as same from base b
  )
  select x.rnk,x.team_id,x.team_code,x.team_name,x.project_name,x.organization,x.competition_code,x.competition_label,
    x.level_code,x.level_label,x.governorate_code,x.governorate_name,x.judges_submitted,x.judges_required,
    round(x.avg_core,2),round(x.avg_bonus,2),x.rnk=1,x.same>1,x.is_published
  from ranked x order by x.competition_sort,x.rnk,x.team_code;
end;
$$;

create or replace function public.get_competitions()
returns table (code text, organization public.organization_code, label text, sort_order int,
               is_published boolean, published_at timestamptz, template_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_approved_user() then
    raise exception 'An approved active account is required' using errcode='42501';
  end if;
  return query select c.code,c.organization,c.label,c.sort_order,c.is_published,c.published_at,c.template_id
    from public.competitions c order by c.sort_order;
end;
$$;

grant execute on function public.get_leaderboard(text,text,text,text) to authenticated;
grant execute on function public.get_competitions() to authenticated;

