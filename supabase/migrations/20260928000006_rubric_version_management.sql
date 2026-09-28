-- =============================================================================
-- Immutable rubric versioning and administrator draft/publish workflow
-- =============================================================================

create type public.rubric_lifecycle as enum ('draft', 'published', 'archived');

alter table public.rubric_templates
  add column family_id text,
  add column version int,
  add column lifecycle public.rubric_lifecycle,
  add column based_on_id text references public.rubric_templates(id),
  add column created_by uuid references public.profiles(id) on delete set null,
  add column published_at timestamptz,
  add column published_by uuid references public.profiles(id) on delete set null,
  add column updated_at timestamptz not null default now();

update public.rubric_templates set
  family_id = id, version = 1, lifecycle = 'published', published_at = created_at
where family_id is null;

alter table public.rubric_templates
  alter column family_id set not null,
  alter column version set not null,
  alter column lifecycle set not null;
alter table public.rubric_templates add constraint rubric_templates_family_version_key unique (family_id, version);
create unique index rubric_one_draft_per_family on public.rubric_templates(family_id) where lifecycle = 'draft';

alter table public.competitions add column rubric_family_id text;
update public.competitions set rubric_family_id = template_id where rubric_family_id is null;
alter table public.competitions alter column rubric_family_id set not null;

alter table public.teams add column template_id text references public.rubric_templates(id);
update public.teams t set template_id = c.template_id
from public.levels l join public.competitions c on c.code = l.competition_code
where l.code = t.level_code and t.template_id is null;
alter table public.teams alter column template_id set not null;
create index teams_template_idx on public.teams(template_id);

create table public.rubric_score_levels (
  template_id text not null references public.rubric_templates(id) on delete cascade,
  value smallint not null check (value between 1 and 5),
  label text not null,
  description text not null,
  primary key (template_id, value)
);
insert into public.rubric_score_levels (template_id, value, label, description)
select t.id, s.value, s.label, s.description from public.rubric_templates t cross join public.score_levels s;

alter table public.rubric_score_levels enable row level security;
revoke all on public.rubric_score_levels from anon, authenticated;
grant select on public.rubric_score_levels to authenticated;
create policy rubric_score_levels_read on public.rubric_score_levels for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.teams t join public.team_judges tj on tj.team_id = t.id
    where t.template_id = rubric_score_levels.template_id and tj.judge_id = auth.uid()
  )
);

-- Published versions are immutable. Draft writes are available only through the RPCs below.
create or replace function public.guard_rubric_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_template text; v_state public.rubric_lifecycle;
begin
  v_template := case tg_table_name
    when 'rubric_templates' then coalesce(new.id, old.id)
    else coalesce(new.template_id, old.template_id) end;
  if tg_table_name = 'rubric_templates' and tg_op = 'UPDATE'
     and old.lifecycle = 'published' and new.lifecycle = 'archived'
     and (to_jsonb(new) - array['lifecycle','updated_at']) = (to_jsonb(old) - array['lifecycle','updated_at']) then
    return new;
  end if;
  select lifecycle into v_state from public.rubric_templates where id = v_template;
  if v_state <> 'draft' then
    raise exception 'Published rubric versions are immutable; create a draft version' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger rubric_templates_immutable before update or delete on public.rubric_templates for each row execute function public.guard_rubric_immutable();
create trigger rubric_sections_immutable before insert or update or delete on public.rubric_sections for each row execute function public.guard_rubric_immutable();
create trigger rubric_criteria_immutable before insert or update or delete on public.rubric_criteria for each row execute function public.guard_rubric_immutable();
create trigger rubric_score_levels_immutable before insert or update or delete on public.rubric_score_levels for each row execute function public.guard_rubric_immutable();

-- Pin every team to one immutable rubric version.
create or replace function public.guard_team_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_active text; v_old_family text; v_new_family text;
begin
  new.team_code := btrim(new.team_code); new.name := btrim(new.name); new.project_name := btrim(new.project_name);
  select c.template_id, c.rubric_family_id into v_active, v_new_family
  from public.levels l join public.competitions c on c.code = l.competition_code where l.code = new.level_code;
  if tg_op = 'INSERT' then new.template_id := v_active; return new; end if;
  select family_id into v_old_family from public.rubric_templates where id = old.template_id;
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

create or replace function public.start_evaluation(p_team_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_template text; v_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not public.is_assigned_judge(p_team_id) then raise exception 'You are not an approved judge assigned to this team' using errcode = '42501'; end if;
  select template_id into v_template from public.teams where id = p_team_id;
  insert into public.evaluations (team_id, judge_id, template_id) values (p_team_id, v_uid, v_template)
  on conflict (team_id, judge_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.evaluations where team_id = p_team_id and judge_id = v_uid;
  else
    insert into public.evaluation_scores (evaluation_id, criterion_id)
    select v_id, id from public.rubric_criteria where template_id = v_template;
    perform public._recompute_evaluation(v_id);
    perform public._audit('evaluation.created', 'evaluation', v_id::text, p_team_id, v_id, jsonb_build_object('template_id', v_template));
  end if;
  return v_id;
end;
$$;

create or replace function public._team_results()
returns table (
  team_id uuid, team_code text, team_name text, project_name text,
  organization public.organization_code, competition_code text, competition_label text,
  competition_sort int, is_published boolean,
  level_code text, level_label text, governorate_code text, governorate_name text,
  judges_required int, judges_submitted int, is_complete boolean,
  avg_core numeric, avg_bonus numeric, provisional_core numeric, provisional_bonus numeric
) language sql stable security definer set search_path = public as $$
  select t.id, t.team_code, t.name, t.project_name, c.organization, c.code, c.label, c.sort_order, c.is_published,
    l.code, l.label, g.code, g.name, coalesce(a.required,0), coalesce(s.submitted,0),
    (coalesce(a.required,0)>0 and coalesce(s.submitted,0)=coalesce(a.required,0)),
    case when coalesce(a.required,0)>0 and coalesce(s.submitted,0)=coalesce(a.required,0) then s.avg_core end,
    case when coalesce(a.required,0)>0 and coalesce(s.submitted,0)=coalesce(a.required,0) then s.avg_bonus end,
    s.avg_core, s.avg_bonus
  from public.teams t join public.levels l on l.code=t.level_code join public.competitions c on c.code=l.competition_code join public.governorates g on g.code=t.governorate_code
  left join lateral (select count(*)::int required from public.team_judges tj where tj.team_id=t.id) a on true
  left join lateral (
    select count(*)::int submitted, avg(e.core_total)::numeric avg_core, avg(e.bonus_total)::numeric avg_bonus
    from public.evaluations e join public.team_judges tj on tj.team_id=e.team_id and tj.judge_id=e.judge_id
    where e.team_id=t.id and e.template_id=t.template_id and e.status='submitted'
  ) s on true;
$$;

create or replace function public.admin_create_rubric_draft(p_source_template text)
returns text language plpgsql security definer set search_path = public as $$
declare src public.rubric_templates%rowtype; v_id text; v_version int; sec record; v_sid text;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into src from public.rubric_templates where id=p_source_template;
  if not found then raise exception 'Rubric not found'; end if;
  select id into v_id from public.rubric_templates where family_id=src.family_id and lifecycle='draft';
  if v_id is not null then return v_id; end if;
  select coalesce(max(version),0)+1 into v_version from public.rubric_templates where family_id=src.family_id;
  v_id := src.family_id || '_V' || v_version;
  insert into public.rubric_templates(id,title,subtitle,source_pdf,scale_instruction,guidance,core_max,bonus_max,family_id,version,lifecycle,based_on_id,created_by)
  values(v_id,src.title,src.subtitle,src.source_pdf,src.scale_instruction,src.guidance,src.core_max,src.bonus_max,src.family_id,v_version,'draft',src.id,auth.uid());
  for sec in select * from public.rubric_sections where template_id=src.id order by position loop
    v_sid := v_id || case when sec.is_bonus then '.BONUS' else '.S'||sec.position end;
    insert into public.rubric_sections(id,template_id,position,title,weight,is_bonus) values(v_sid,v_id,sec.position,sec.title,sec.weight,sec.is_bonus);
    insert into public.rubric_criteria(id,section_id,template_id,is_bonus,position,title,description,max_points)
    select v_sid||'.C'||position,v_sid,v_id,is_bonus,position,title,description,max_points from public.rubric_criteria where section_id=sec.id order by position;
  end loop;
  insert into public.rubric_score_levels select v_id,value,label,description from public.rubric_score_levels where template_id=src.id;
  perform public._audit('rubric.draft_created','rubric_template',v_id,null,null,jsonb_build_object('family_id',src.family_id,'version',v_version,'based_on',src.id));
  return v_id;
end;
$$;

create or replace function public.admin_save_rubric_draft(p_template_id text, p_payload jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare t public.rubric_templates%rowtype; s jsonb; c jsonb; lvl jsonb; s_pos int:=0; c_pos int; s_id text; core int:=0; bonus int:=0; is_b boolean;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into t from public.rubric_templates where id=p_template_id for update;
  if not found then raise exception 'Rubric not found'; end if;
  if t.lifecycle <> 'draft' then raise exception 'Only draft rubric versions can be edited'; end if;
  if exists(select 1 from public.evaluations where template_id=p_template_id) then raise exception 'A rubric version with evaluations is immutable'; end if;
  delete from public.rubric_sections where template_id=p_template_id;
  for s in select value from jsonb_array_elements(coalesce(p_payload->'sections','[]')) loop
    s_pos:=s_pos+1; is_b:=coalesce((s->>'is_bonus')::boolean,false);
    s_id:=p_template_id||case when is_b then '.BONUS' else '.S'||s_pos end;
    insert into public.rubric_sections(id,template_id,position,title,weight,is_bonus)
    values(s_id,p_template_id,s_pos,left(btrim(s->>'title'),500),(s->>'weight')::int,is_b);
    c_pos:=0;
    for c in select value from jsonb_array_elements(coalesce(s->'criteria','[]')) loop
      c_pos:=c_pos+1;
      insert into public.rubric_criteria(id,section_id,template_id,is_bonus,position,title,description,max_points)
      values(s_id||'.C'||c_pos,s_id,p_template_id,is_b,c_pos,left(btrim(c->>'title'),500),left(btrim(c->>'description'),8000),5);
    end loop;
    if is_b then bonus:=bonus+(s->>'weight')::int; else core:=core+(s->>'weight')::int; end if;
  end loop;
  update public.rubric_templates set title=left(btrim(p_payload->>'title'),500), subtitle=left(btrim(p_payload->>'subtitle'),500),
    scale_instruction=left(btrim(p_payload->>'scale_instruction'),2000), guidance=left(btrim(p_payload->>'guidance'),8000),
    core_max=greatest(core,1), bonus_max=bonus, updated_at=now() where id=p_template_id;
  delete from public.rubric_score_levels where template_id=p_template_id;
  for lvl in select value from jsonb_array_elements(coalesce(p_payload->'score_levels','[]')) loop
    insert into public.rubric_score_levels(template_id,value,label,description)
    values(p_template_id,(lvl->>'value')::int,left(btrim(lvl->>'label'),200),left(btrim(lvl->>'description'),2000));
  end loop;
  perform public._audit('rubric.draft_saved','rubric_template',p_template_id,null,null,jsonb_build_object('core_max',core,'bonus_max',bonus));
  return p_template_id;
end;
$$;

create or replace function public.admin_publish_rubric(p_template_id text, p_team_handling text)
returns text language plpgsql security definer set search_path = public as $$
declare t public.rubric_templates%rowtype; comp text; bad text;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_team_handling not in ('keep_existing','move_unevaluated') then raise exception 'Choose how existing teams should be handled'; end if;
  select * into t from public.rubric_templates where id=p_template_id for update;
  if not found then raise exception 'Rubric not found'; end if;
  if t.lifecycle <> 'draft' then raise exception 'Only a draft can be published'; end if;
  if btrim(t.title)='' or btrim(t.subtitle)='' or btrim(t.scale_instruction)='' or btrim(t.guidance)='' then raise exception 'Rubric title and instructions are required'; end if;
  if t.core_max <> 100 then raise exception 'Core section weights must total 100 (currently %)',t.core_max; end if;
  if (select count(*) from public.rubric_score_levels where template_id=t.id)<>5 then raise exception 'Scoring scale must contain levels 1 through 5'; end if;
  if exists(select 1 from public.rubric_score_levels where template_id=t.id and (btrim(label)='' or btrim(description)='')) then raise exception 'Every scoring level needs a label and description'; end if;
  if (select count(*) from public.rubric_sections where template_id=t.id and is_bonus)<>1 then raise exception 'Exactly one optional bonus section is required'; end if;
  if exists(select 1 from public.rubric_sections s where s.template_id=t.id and btrim(s.title)='')
     or exists(select 1 from public.rubric_criteria c where c.template_id=t.id and (btrim(c.title)='' or btrim(c.description)='')) then
    raise exception 'Every section and criterion needs a title and description';
  end if;
  select string_agg(s.title,', ') into bad from public.rubric_sections s where s.template_id=t.id and
    (not exists(select 1 from public.rubric_criteria c where c.section_id=s.id) or s.weight<>(select coalesce(sum(max_points),0) from public.rubric_criteria c where c.section_id=s.id));
  if bad is not null then raise exception 'Invalid section weights or criteria: %',bad; end if;
  select code into comp from public.competitions where rubric_family_id=t.family_id;
  update public.rubric_templates set lifecycle='archived',updated_at=now() where family_id=t.family_id and lifecycle='published';
  update public.rubric_templates set lifecycle='published',published_at=now(),published_by=auth.uid(),updated_at=now() where id=t.id;
  update public.competitions set template_id=t.id where code=comp;
  if p_team_handling='move_unevaluated' then
    update public.teams x set template_id=t.id where x.level_code in (select code from public.levels where competition_code=comp)
      and not exists(select 1 from public.evaluations e where e.team_id=x.id);
  end if;
  perform public._audit('rubric.published','rubric_template',t.id,null,null,jsonb_build_object('family_id',t.family_id,'version',t.version,'team_handling',p_team_handling));
  return t.id;
end;
$$;

-- Judges see only versions pinned to assigned teams; admins see the complete history.
drop policy rubric_templates_read on public.rubric_templates;
create policy rubric_templates_read on public.rubric_templates for select to authenticated using (
  public.is_admin() or exists(select 1 from public.teams t join public.team_judges tj on tj.team_id=t.id where t.template_id=rubric_templates.id and tj.judge_id=auth.uid())
);
drop policy rubric_sections_read on public.rubric_sections;
create policy rubric_sections_read on public.rubric_sections for select to authenticated using (
  public.is_admin() or exists(select 1 from public.teams t join public.team_judges tj on tj.team_id=t.id where t.template_id=rubric_sections.template_id and tj.judge_id=auth.uid())
);
drop policy rubric_criteria_read on public.rubric_criteria;
create policy rubric_criteria_read on public.rubric_criteria for select to authenticated using (
  public.is_admin() or exists(select 1 from public.teams t join public.team_judges tj on tj.team_id=t.id where t.template_id=rubric_criteria.template_id and tj.judge_id=auth.uid())
);

grant execute on function public.admin_create_rubric_draft(text) to authenticated;
grant execute on function public.admin_save_rubric_draft(text,jsonb) to authenticated;
grant execute on function public.admin_publish_rubric(text,text) to authenticated;
