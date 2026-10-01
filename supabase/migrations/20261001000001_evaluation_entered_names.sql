-- Team and project names entered on a rubric belong to that independent
-- evaluation. They intentionally do not inherit from or update teams.

alter table public.evaluations
  add column entered_team_name text not null default '',
  add column entered_project_name text not null default '',
  add constraint evaluations_entered_team_name_length check (char_length(entered_team_name)<=200),
  add constraint evaluations_entered_project_name_length check (char_length(entered_project_name)<=200);

create or replace function public.save_evaluation(
  p_evaluation_id uuid,
  p_scores jsonb,
  p_section_notes jsonb,
  p_overall_notes text,
  p_team_name text,
  p_project_name text
) returns public.evaluations language plpgsql security definer set search_path=public as $$
declare v_eval public.evaluations%rowtype;
begin
  v_eval:=public._lock_own_evaluation(p_evaluation_id);
  if v_eval.status='submitted' then
    raise exception 'This evaluation has been submitted and is locked' using errcode='P0001';
  end if;
  perform public._apply_evaluation_changes(v_eval,p_scores,p_section_notes,p_overall_notes);
  update public.evaluations set
    entered_team_name=case when p_team_name is null then entered_team_name else left(p_team_name,200) end,
    entered_project_name=case when p_project_name is null then entered_project_name else left(p_project_name,200) end
  where id=v_eval.id;
  return public._recompute_evaluation(v_eval.id);
end;
$$;

create or replace function public.submit_evaluation(
  p_evaluation_id uuid,
  p_scores jsonb,
  p_section_notes jsonb,
  p_overall_notes text,
  p_team_name text,
  p_project_name text
) returns public.evaluations language plpgsql security definer set search_path=public as $$
declare v_eval public.evaluations%rowtype;v_missing int;
begin
  v_eval:=public._lock_own_evaluation(p_evaluation_id);
  if v_eval.status='submitted' then return v_eval; end if;

  perform public._apply_evaluation_changes(v_eval,p_scores,p_section_notes,p_overall_notes);
  update public.evaluations set
    entered_team_name=case when p_team_name is null then entered_team_name else left(p_team_name,200) end,
    entered_project_name=case when p_project_name is null then entered_project_name else left(p_project_name,200) end
  where id=v_eval.id returning * into v_eval;

  if btrim(v_eval.entered_team_name)='' then
    raise exception 'Team Name is required before submission' using errcode='22023';
  end if;
  if btrim(v_eval.entered_project_name)='' then
    raise exception 'Project Name is required before submission' using errcode='22023';
  end if;

  v_eval:=public._recompute_evaluation(v_eval.id);
  v_missing:=v_eval.core_criteria_count-v_eval.core_scored_count;
  if v_missing>0 then
    raise exception 'Evaluation is incomplete: % core criteria still need a score',v_missing using errcode='P0001';
  end if;

  update public.evaluations set status='submitted',submitted_at=now()
    where id=v_eval.id returning * into v_eval;
  perform public._audit('evaluation.submitted','evaluation',v_eval.id::text,v_eval.team_id,v_eval.id,
    jsonb_build_object('core_total',v_eval.core_total,'bonus_total',v_eval.bonus_total,
      'team_name',v_eval.entered_team_name,'project_name',v_eval.entered_project_name));
  return v_eval;
end;
$$;

-- Preserve the legacy signature for older clients, but do not allow it to
-- bypass the required names. It submits only when names were saved already.
create or replace function public.submit_evaluation(
  p_evaluation_id uuid,
  p_scores jsonb default null,
  p_section_notes jsonb default null,
  p_overall_notes text default null
) returns public.evaluations language plpgsql security definer set search_path=public as $$
declare v_eval public.evaluations%rowtype;
begin
  select * into v_eval from public.evaluations where id=p_evaluation_id;
  return public.submit_evaluation(p_evaluation_id,p_scores,p_section_notes,p_overall_notes,
    v_eval.entered_team_name,v_eval.entered_project_name);
end;
$$;

revoke all on function public.save_evaluation(uuid,jsonb,jsonb,text,text,text) from public,anon;
revoke all on function public.submit_evaluation(uuid,jsonb,jsonb,text,text,text) from public,anon;
grant execute on function public.save_evaluation(uuid,jsonb,jsonb,text,text,text) to authenticated;
grant execute on function public.submit_evaluation(uuid,jsonb,jsonb,text,text,text) to authenticated;

