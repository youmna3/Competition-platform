-- Judges may read every currently active competition rubric, but never draft
-- or archived versions. Leaderboard calculations remain unchanged and are now
-- callable only by administrators.

create or replace function public.can_read_judge_rubric(p_template_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_user() and (
    exists (
      select 1
      from public.competitions c
      join public.rubric_templates t on t.id = c.template_id
      where c.template_id = p_template_id
        and t.lifecycle = 'published'
    )
    or exists (
      select 1
      from public.teams t
      join public.team_judges tj on tj.team_id = t.id
      where t.template_id = p_template_id
        and tj.judge_id = auth.uid()
    )
  );
$$;

revoke all on function public.can_read_judge_rubric(text) from public, anon, authenticated;
grant execute on function public.can_read_judge_rubric(text) to authenticated;

drop policy if exists rubric_templates_read on public.rubric_templates;
create policy rubric_templates_read on public.rubric_templates for select to authenticated using (
  public.is_admin() or public.can_read_judge_rubric(id)
);

drop policy if exists rubric_sections_read on public.rubric_sections;
create policy rubric_sections_read on public.rubric_sections for select to authenticated using (
  public.is_admin() or public.can_read_judge_rubric(template_id)
);

drop policy if exists rubric_criteria_read on public.rubric_criteria;
create policy rubric_criteria_read on public.rubric_criteria for select to authenticated using (
  public.is_admin() or public.can_read_judge_rubric(template_id)
);

drop policy if exists rubric_score_levels_read on public.rubric_score_levels;
create policy rubric_score_levels_read on public.rubric_score_levels for select to authenticated using (
  public.is_admin() or public.can_read_judge_rubric(template_id)
);

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
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
  with base as (
    select r.*, round(r.avg_core, 6) as sort_core
    from public._team_results() r
    where r.is_complete
      and (p_organization is null or r.organization::text = p_organization)
      and (p_competition is null or r.competition_code = p_competition)
      and (p_level is null or r.level_code = p_level)
      and (p_governorate is null or r.governorate_code = p_governorate)
  ), ranked as (
    select b.*,
      rank() over (partition by b.competition_code order by b.sort_core desc)::int as rnk,
      count(*) over (partition by b.competition_code, b.sort_core)::int as same
    from base b
  )
  select x.rnk, x.team_id, x.team_code, x.team_name, x.project_name,
    x.organization, x.competition_code, x.competition_label,
    x.level_code, x.level_label, x.governorate_code, x.governorate_name,
    x.judges_submitted, x.judges_required,
    round(x.avg_core, 2), round(x.avg_bonus, 2),
    x.rnk = 1, x.same > 1, x.is_published
  from ranked x
  order by x.competition_sort, x.rnk, x.team_code;
end;
$$;

revoke all on function public.get_leaderboard(text,text,text,text) from public, anon, authenticated;
grant execute on function public.get_leaderboard(text,text,text,text) to authenticated;
