-- Team IDs are case-insensitively unique within DEMI or DECI, not globally.
-- Existing team UUIDs and every referencing assignment/evaluation remain intact.

alter table public.teams add column organization public.organization_code;

-- This is a metadata backfill, not a user-visible team edit. Avoid changing
-- updated_at or emitting one audit event per preserved team.
alter table public.teams disable trigger teams_touch;
alter table public.teams disable trigger teams_audit;
update public.teams t
set organization = l.organization
from public.levels l
where l.code = t.level_code;
alter table public.teams enable trigger teams_audit;
alter table public.teams enable trigger teams_touch;

alter table public.teams alter column organization set not null;

drop index public.teams_team_code_key;
create unique index teams_organization_team_code_key
  on public.teams (organization, lower(team_code));

comment on column public.teams.organization is
  'Maintained from level_code by teams_guard; scopes the public Team ID to DEMI or DECI.';

-- Keep the stored organization authoritative and derived from the selected
-- level. Clients cannot move a team between organizations by spoofing it.
create or replace function public.guard_team_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_active text;
  v_old_family text;
  v_new_family text;
  v_new_organization public.organization_code;
begin
  new.team_code := btrim(new.team_code);
  new.name := btrim(new.name);
  new.project_name := btrim(new.project_name);

  select c.template_id, c.rubric_family_id, l.organization
    into v_active, v_new_family, v_new_organization
  from public.levels l
  join public.competitions c on c.code = l.competition_code
  where l.code = new.level_code;

  if v_new_organization is null then
    raise exception 'Unknown grade / level "%"', new.level_code using errcode = '23503';
  end if;
  new.organization := v_new_organization;

  if tg_op = 'INSERT' then
    new.template_id := v_active;
    return new;
  end if;

  select family_id into v_old_family
  from public.rubric_templates
  where id = old.template_id;

  if new.level_code <> old.level_code and v_old_family is distinct from v_new_family then
    if exists (select 1 from public.evaluations where team_id = old.id) then
      raise exception 'Team % already has evaluations and cannot move to a different rubric family', old.team_code using errcode = 'P0001';
    end if;
    new.template_id := v_active;
  elsif new.template_id <> old.template_id then
    if exists (select 1 from public.evaluations where team_id = old.id) then
      raise exception 'A team with evaluations cannot change rubric version' using errcode = 'P0001';
    end if;
    if (select family_id from public.rubric_templates where id = new.template_id) <> v_new_family then
      raise exception 'Team rubric version does not match its competition' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Atomic import/upsert scoped by the organization derived from level_code.
create or replace function public.admin_import_teams(p_rows jsonb, p_replace_assignments boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_errors jsonb := '[]'::jsonb;
  v_inserted int := 0;
  v_updated int := 0;
  v_assigned int := 0;
  v_team_id uuid;
  v_gov text;
  v_email text;
  v_judge uuid;
  v_judges uuid[];
  v_existed boolean;
  v_n int;
  v_org public.organization_code;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'At most 5000 rows per import' using errcode = '22023';
  end if;

  -- Pass 1: validate the complete file before writing anything.
  for r in
    select ord::int as rownum,
           btrim(coalesce(e ->> 'team_code', '')) as team_code,
           btrim(coalesce(e ->> 'name', '')) as name,
           btrim(coalesce(e ->> 'project_name', '')) as project_name,
           btrim(coalesce(e ->> 'level_code', '')) as level_code,
           btrim(coalesce(e ->> 'governorate', '')) as governorate,
           coalesce(e -> 'judge_emails', '[]'::jsonb) as judge_emails
    from jsonb_array_elements(p_rows) with ordinality as a(e, ord)
  loop
    select organization into v_org from public.levels where code = r.level_code;

    if r.team_code = '' then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', 'Team ID is required');
    end if;
    if r.name = '' then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', 'Team name is required');
    end if;
    if r.project_name = '' then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', 'Project name is required');
    end if;
    if v_org is null then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Unknown organization / grade-level "%s"', r.level_code));
    end if;
    if not exists (
      select 1 from public.governorates
      where lower(code) = lower(r.governorate) or lower(name) = lower(r.governorate)
    ) then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Unknown governorate "%s"', r.governorate));
    end if;

    select count(*) into v_n
    from jsonb_array_elements(p_rows) x
    join public.levels lx on lx.code = btrim(x ->> 'level_code')
    where lower(btrim(x ->> 'team_code')) = lower(r.team_code)
      and lx.organization = v_org;
    if r.team_code <> '' and v_org is not null and v_n > 1 then
      v_errors := v_errors || jsonb_build_object(
        'row', r.rownum,
        'message', format('Team ID "%s" appears more than once for %s in the file', r.team_code, v_org)
      );
    end if;

    if jsonb_typeof(r.judge_emails) <> 'array' then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', 'judge_emails must be a list');
    else
      for v_email in
        select lower(btrim(x)) from jsonb_array_elements_text(r.judge_emails) x where btrim(x) <> ''
      loop
        if not exists (select 1 from public.profiles where lower(email) = v_email and status = 'approved') then
          v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Judge "%s" is not an approved account', v_email));
        end if;
      end loop;
    end if;

    if exists (
      select 1
      from public.teams t
      join public.levels lo on lo.code = t.level_code
      join public.competitions co on co.code = lo.competition_code
      join public.levels ln on ln.code = r.level_code
      join public.competitions cn on cn.code = ln.competition_code
      where lower(t.team_code) = lower(r.team_code)
        and lo.organization = ln.organization
        and co.template_id <> cn.template_id
        and exists (select 1 from public.evaluations e where e.team_id = t.id)
    ) then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Team "%s" already has evaluations; its rubric cannot change', r.team_code));
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors, 'inserted', 0, 'updated', 0, 'assignments_added', 0);
  end if;

  -- Pass 2: upsert by organization + case-insensitive Team ID.
  for r in
    select btrim(e ->> 'team_code') as team_code,
           btrim(e ->> 'name') as name,
           btrim(e ->> 'project_name') as project_name,
           btrim(e ->> 'level_code') as level_code,
           btrim(e ->> 'governorate') as governorate,
           coalesce(e -> 'judge_emails', '[]'::jsonb) as judge_emails
    from jsonb_array_elements(p_rows) a(e)
  loop
    select organization into v_org from public.levels where code = r.level_code;
    select code into v_gov
    from public.governorates
    where lower(code) = lower(r.governorate) or lower(name) = lower(r.governorate)
    limit 1;

    select t.id into v_team_id
    from public.teams t
    where t.organization = v_org
      and lower(t.team_code) = lower(r.team_code);

    v_existed := v_team_id is not null;
    if v_existed then
      update public.teams
      set name = r.name,
          project_name = r.project_name,
          level_code = r.level_code,
          governorate_code = v_gov
      where id = v_team_id
        and (name, project_name, level_code, governorate_code)
          is distinct from (r.name, r.project_name, r.level_code, v_gov);
      v_updated := v_updated + 1;
    else
      insert into public.teams (team_code, name, project_name, level_code, governorate_code, created_by)
      values (r.team_code, r.name, r.project_name, r.level_code, v_gov, auth.uid())
      returning id into v_team_id;
      v_inserted := v_inserted + 1;
    end if;

    select coalesce(array_agg(p.id), '{}') into v_judges
    from public.profiles p
    where lower(p.email) in (
      select lower(btrim(x)) from jsonb_array_elements_text(r.judge_emails) x
    );

    if p_replace_assignments then
      delete from public.team_judges
      where team_id = v_team_id and not (judge_id = any (v_judges));
    end if;
    foreach v_judge in array v_judges loop
      insert into public.team_judges (team_id, judge_id, assigned_by)
      values (v_team_id, v_judge, auth.uid())
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_assigned := v_assigned + v_n;
    end loop;
  end loop;

  perform public._audit(
    'teams.imported', 'team', null, null, null,
    jsonb_build_object(
      'inserted', v_inserted,
      'updated', v_updated,
      'assignments_added', v_assigned,
      'replace_assignments', p_replace_assignments
    )
  );
  return jsonb_build_object(
    'ok', true,
    'errors', '[]'::jsonb,
    'inserted', v_inserted,
    'updated', v_updated,
    'assignments_added', v_assigned
  );
end;
$$;

