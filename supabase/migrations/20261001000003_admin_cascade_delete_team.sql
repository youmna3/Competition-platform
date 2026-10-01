-- Permanently delete a team and all of its judging data through one audited,
-- administrator-only transaction. Historical rubric versions are not touched.

create or replace function public.admin_delete_team(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
  v_assignment_count integer;
  v_evaluation_count integer;
  v_draft_count integer;
  v_submitted_count integer;
  v_score_count integer;
  v_score_note_count integer;
  v_evaluation_note_count integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select * into v_team
  from public.teams
  where id = p_team_id
  for update;

  if not found then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  select count(*) into v_assignment_count
  from public.team_judges
  where team_id = p_team_id;

  select
    count(*),
    count(*) filter (where status = 'draft'),
    count(*) filter (where status = 'submitted'),
    count(*) filter (
      where nullif(btrim(overall_notes), '') is not null
         or section_notes <> '{}'::jsonb
    )
  into v_evaluation_count, v_draft_count, v_submitted_count, v_evaluation_note_count
  from public.evaluations
  where team_id = p_team_id;

  select
    count(*),
    count(*) filter (where nullif(btrim(es.note), '') is not null)
  into v_score_count, v_score_note_count
  from public.evaluation_scores es
  join public.evaluations e on e.id = es.evaluation_id
  where e.team_id = p_team_id;

  -- This audit event is inserted before deletion so it captures the original
  -- team and dependency counts. It is committed only if every delete succeeds.
  perform public._audit(
    'team.deleted_cascade',
    'team',
    v_team.id::text,
    v_team.id,
    null,
    jsonb_build_object(
      'team_id', v_team.team_code,
      'team_uuid', v_team.id,
      'team_name', v_team.name,
      'project_name', v_team.project_name,
      'organization', v_team.organization,
      'level_code', v_team.level_code,
      'governorate_code', v_team.governorate_code,
      'deleted_by', auth.uid(),
      'deleted_at', now(),
      'assignments_deleted', v_assignment_count,
      'evaluations_deleted', v_evaluation_count,
      'draft_evaluations_deleted', v_draft_count,
      'submitted_evaluations_deleted', v_submitted_count,
      'scores_deleted', v_score_count,
      'judge_notes_deleted', v_score_note_count + v_evaluation_note_count
    )
  );

  -- Score rows are deliberately protected while an evaluation is submitted.
  -- Move only this team's submitted rows back to draft inside this transaction,
  -- then remove the dependent rows explicitly. No intermediate state is visible,
  -- and any failure rolls the entire function back, including the audit event.
  update public.evaluations
  set status = 'draft', submitted_at = null
  where team_id = p_team_id and status = 'submitted';

  delete from public.evaluation_scores es
  using public.evaluations e
  where es.evaluation_id = e.id and e.team_id = p_team_id;

  delete from public.evaluations where team_id = p_team_id;
  delete from public.team_judges where team_id = p_team_id;
  delete from public.teams where id = p_team_id;

  if not found then
    raise exception 'Team deletion failed' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'team_id', v_team.team_code,
    'team_uuid', v_team.id,
    'assignments_deleted', v_assignment_count,
    'evaluations_deleted', v_evaluation_count,
    'draft_evaluations_deleted', v_draft_count,
    'submitted_evaluations_deleted', v_submitted_count,
    'scores_deleted', v_score_count
  );
end;
$$;

comment on function public.admin_delete_team(uuid) is
  'Administrator-only, transactional deletion of a team and all related judging data with a durable audit snapshot.';

revoke execute on function public.admin_delete_team(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_team(uuid) to authenticated;
