-- Present DECI Levels 4 and 5 as one category while retaining the original
-- level value on migrated teams for historical reference. Both legacy levels
-- already point to the same DECI_L45 competition and rubric family.

alter table public.levels
  add column if not exists is_active boolean not null default true;

alter table public.teams
  add column if not exists legacy_level_code text
  check (legacy_level_code is null or legacy_level_code in ('L4', 'L5'));

insert into public.levels(code, organization, label, competition_code, sort_order, is_active)
values ('L45', 'DECI', 'Levels 4 & 5', 'DECI_L45', 6, true)
on conflict (code) do update set
  organization = excluded.organization,
  label = excluded.label,
  competition_code = excluded.competition_code,
  sort_order = excluded.sort_order,
  is_active = true;

-- This normalization preserves team UUIDs, pinned rubric versions,
-- assignments, evaluations and scores. Avoid presenting it as a user edit in
-- timestamps/audit history; the old value is retained in legacy_level_code.
alter table public.teams disable trigger teams_touch;
alter table public.teams disable trigger teams_audit;
update public.teams
set legacy_level_code = level_code,
    level_code = 'L45'
where level_code in ('L4', 'L5');
alter table public.teams enable trigger teams_audit;
alter table public.teams enable trigger teams_touch;

update public.levels set is_active = false where code in ('L4', 'L5');

comment on column public.levels.is_active is
  'Only active rows are offered for registration, imports and filters; inactive rows preserve historical reference values.';
comment on column public.teams.legacy_level_code is
  'Original L4 or L5 value retained when the team was normalized to the combined L45 category.';

-- API callers cannot register or move teams onto hidden legacy levels.
create or replace function public.guard_team_active_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.levels
    where code = new.level_code and is_active
  ) then
    raise exception 'Grade / level % is not available for team registration', new.level_code
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists teams_active_level_guard on public.teams;
create trigger teams_active_level_guard
before insert or update of level_code on public.teams
for each row execute function public.guard_team_active_level();

revoke all on function public.guard_team_active_level() from public, anon, authenticated;

-- Keep inactive legacy reference rows out of administrator dashboard filters.
create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  with r as (select * from public._team_results()),
  asg as (
    select tj.team_id, tj.judge_id, e.status
    from public.team_judges tj
    left join public.evaluations e on e.team_id = tj.team_id and e.judge_id = tj.judge_id
  )
  select jsonb_build_object(
    'total_teams', (select count(*) from public.teams),
    'total_judges', (select count(*) from public.profiles where role = 'judge' and status = 'approved'),
    'pending_judges', (select count(*) from public.profiles where status = 'pending'),
    'total_assignments', (select count(*) from asg),
    'completed_evaluations', (select count(*) from asg where status = 'submitted'),
    'pending_evaluations', (select count(*) from asg where status is distinct from 'submitted'),
    'draft_evaluations', (select count(*) from asg where status = 'draft'),
    'not_started_evaluations', (select count(*) from asg where status is null),
    'teams_complete', (select count(*) from r where is_complete),
    'teams_pending', (select count(*) from r where not is_complete and judges_required > 0),
    'teams_unassigned', (select count(*) from r where judges_required = 0),
    'by_competition', coalesce((
      select jsonb_agg(x order by x.sort_order) from (
        select c.code, c.label, c.organization, c.sort_order, c.is_published,
          count(r.team_id) as teams,
          count(r.team_id) filter (where r.is_complete) as complete,
          count(r.team_id) filter (where not coalesce(r.is_complete, false)) as pending,
          round(avg(r.avg_core), 2) as avg_core
        from public.competitions c
        left join r on r.competition_code = c.code
        group by c.code
      ) x), '[]'::jsonb),
    'by_level', coalesce((
      select jsonb_agg(x order by x.sort_order) from (
        select l.code, l.label, l.organization, l.sort_order,
          count(r.team_id) as teams,
          count(r.team_id) filter (where r.is_complete) as complete,
          round(avg(r.avg_core), 2) as avg_core
        from public.levels l
        left join r on r.level_code = l.code
        where l.is_active
        group by l.code
      ) x), '[]'::jsonb),
    'by_governorate', coalesce((
      select jsonb_agg(x order by x.sort_order) from (
        select g.code, g.name, g.sort_order,
          count(r.team_id) as teams,
          count(r.team_id) filter (where r.is_complete) as complete,
          count(r.team_id) filter (where r.team_id is not null and not r.is_complete) as pending,
          round(avg(r.avg_core), 2) as avg_core
        from public.governorates g left join r on r.governorate_code = g.code
        group by g.code
      ) x), '[]'::jsonb),
    'top_teams', coalesce((
      select jsonb_agg(x order by x.competition_sort) from (
        select distinct on (r.competition_code)
          r.competition_code, r.competition_label, r.competition_sort, r.organization,
          round(r.avg_core, 2) as avg_core, round(r.avg_bonus, 2) as avg_bonus,
          (select jsonb_agg(jsonb_build_object('team_code', r2.team_code, 'team_name', r2.team_name,
                                               'project_name', r2.project_name, 'governorate', r2.governorate_name)
                            order by r2.team_code)
             from r r2 where r2.is_complete and r2.competition_code = r.competition_code
               and round(r2.avg_core, 6) = round(r.avg_core, 6)) as teams
        from r where r.is_complete
        order by r.competition_code, r.avg_core desc
      ) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
