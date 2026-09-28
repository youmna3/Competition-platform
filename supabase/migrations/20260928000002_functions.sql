-- =============================================================================
-- Helper functions, integrity triggers, audit triggers and RPC endpoints
-- All writes to evaluations go through SECURITY DEFINER RPCs that validate the
-- caller; clients have no direct INSERT/UPDATE/DELETE rights on those tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Identity helpers (used by RLS policies)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

create or replace function public.is_approved_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and status = 'approved'
  );
$$;

create or replace function public.is_assigned_judge(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_user() and exists (
    select 1 from public.team_judges where team_id = p_team_id and judge_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public._audit(
  p_action text, p_entity text, p_entity_id text,
  p_team_id uuid default null, p_evaluation_id uuid default null,
  p_details jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, team_id, evaluation_id, details)
  values (
    auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    p_action, p_entity, p_entity_id, p_team_id, p_evaluation_id, coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public._team_competition(p_team_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select l.competition_code from public.teams t join public.levels l on l.code = t.level_code
  where t.id = p_team_id;
$$;

create or replace function public._bump_signal(p_competition text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_competition is null then return; end if;
  insert into public.results_signal (competition_code, changed_at, version)
  values (p_competition, now(), 1)
  on conflict (competition_code)
  do update set changed_at = now(), version = public.results_signal.version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile (always a *pending judge*)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 200),
    'judge',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep profile e-mail in sync if the auth e-mail changes
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Profile guard: only admins may change role / status; never lose the last admin
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  new.id := old.id;
  new.created_at := old.created_at;

  if old.role = 'admin' and old.status = 'approved'
     and (new.role <> 'admin' or new.status <> 'approved')
     and not exists (
       select 1 from public.profiles
       where role = 'admin' and status = 'approved' and id <> old.id
     ) then
    raise exception 'Cannot remove or disable the last active administrator'
      using errcode = 'P0001';
  end if;

  -- v_uid is null for the service role / SQL editor (trusted contexts)
  if v_uid is not null and not public.is_admin() then
    if new.role <> old.role or new.status <> old.status or new.email <> old.email
       or new.reviewed_at is distinct from old.reviewed_at
       or new.reviewed_by is distinct from old.reviewed_by then
      raise exception 'Only administrators can change roles or approval status'
        using errcode = '42501';
    end if;
  end if;

  if new.role <> old.role or new.status <> old.status then
    new.reviewed_at := now();
    new.reviewed_by := v_uid;
    perform public._audit('profile.access_changed', 'profile', old.id::text, null, null,
      jsonb_build_object('email', old.email,
        'old', jsonb_build_object('role', old.role, 'status', old.status),
        'new', jsonb_build_object('role', new.role, 'status', new.status)));
  end if;

  new.full_name := left(btrim(new.full_name), 200);
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Teams: integrity + audit + signal
-- ---------------------------------------------------------------------------
create or replace function public.guard_team_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_template text;
  v_new_template text;
begin
  new.team_code := btrim(new.team_code);
  new.name := btrim(new.name);
  new.project_name := btrim(new.project_name);
  if tg_op = 'UPDATE' and new.level_code <> old.level_code then
    select c.template_id into v_old_template from public.levels l join public.competitions c on c.code = l.competition_code where l.code = old.level_code;
    select c.template_id into v_new_template from public.levels l join public.competitions c on c.code = l.competition_code where l.code = new.level_code;
    if v_old_template <> v_new_template and exists (select 1 from public.evaluations where team_id = old.id) then
      raise exception 'Team % already has evaluations on the % rubric; its grade/level cannot move to a different rubric', old.team_code, v_old_template
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger teams_guard before insert or update on public.teams
  for each row execute function public.guard_team_update();
create trigger teams_touch before update on public.teams
  for each row execute function public.touch_updated_at();

create or replace function public.audit_team_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._audit('team.created', 'team', new.id::text, new.id, null, to_jsonb(new));
    perform public._bump_signal(public._team_competition(new.id));
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      perform public._audit('team.updated', 'team', new.id::text, new.id, null,
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
    end if;
    perform public._bump_signal((select competition_code from public.levels where code = old.level_code));
    perform public._bump_signal((select competition_code from public.levels where code = new.level_code));
  else
    perform public._audit('team.deleted', 'team', old.id::text, null, null, to_jsonb(old));
    perform public._bump_signal((select competition_code from public.levels where code = old.level_code));
  end if;
  return null;
end;
$$;

create trigger teams_audit after insert or update or delete on public.teams
  for each row execute function public.audit_team_change();

-- ---------------------------------------------------------------------------
-- Assignments: only approved accounts can be assigned
-- ---------------------------------------------------------------------------
create or replace function public.guard_team_judge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.judge_id and status = 'approved') then
    raise exception 'Only approved judge accounts can be assigned to teams' using errcode = 'P0001';
  end if;
  new.assigned_by := coalesce(new.assigned_by, auth.uid());
  return new;
end;
$$;

create trigger team_judges_guard before insert or update on public.team_judges
  for each row execute function public.guard_team_judge();

create or replace function public.audit_team_judge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  perform public._audit(
    case when tg_op = 'DELETE' then 'assignment.removed' else 'assignment.added' end,
    'team_judge', r.team_id::text || ':' || r.judge_id::text, r.team_id, null,
    jsonb_build_object('judge_id', r.judge_id,
                       'judge_email', (select email from public.profiles where id = r.judge_id)));
  perform public._bump_signal(public._team_competition(r.team_id));
  return null;
end;
$$;

create trigger team_judges_audit after insert or delete on public.team_judges
  for each row execute function public.audit_team_judge();

-- ---------------------------------------------------------------------------
-- Evaluations: integrity
-- ---------------------------------------------------------------------------
create or replace function public.guard_evaluation_update()
returns trigger language plpgsql as $$
begin
  if new.team_id <> old.team_id or new.judge_id <> old.judge_id or new.template_id <> old.template_id then
    raise exception 'Evaluation team, judge and rubric are immutable' using errcode = 'P0001';
  end if;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger evaluations_guard before update on public.evaluations
  for each row execute function public.guard_evaluation_update();
create trigger evaluations_touch before update on public.evaluations
  for each row execute function public.touch_updated_at();

create or replace function public.evaluation_signal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._bump_signal(public._team_competition(coalesce(new.team_id, old.team_id)));
  return null;
end;
$$;

create trigger evaluations_signal after insert or delete or update of status, core_total, bonus_total
  on public.evaluations for each row execute function public.evaluation_signal();

-- Scores: criterion must belong to the evaluation's rubric; submitted = locked
create or replace function public.guard_evaluation_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_eval public.evaluations%rowtype;
begin
  select * into v_eval from public.evaluations
  where id = coalesce(new.evaluation_id, old.evaluation_id);

  if v_eval.status = 'submitted' then
    raise exception 'Submitted evaluations are locked. An administrator must reopen it before changes can be made.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.evaluation_id <> old.evaluation_id or new.criterion_id <> old.criterion_id) then
    raise exception 'Score keys are immutable' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.rubric_criteria c
    where c.id = new.criterion_id and c.template_id = v_eval.template_id
  ) then
    raise exception 'Criterion % does not belong to rubric %', new.criterion_id, v_eval.template_id
      using errcode = 'P0001';
  end if;

  new.note := left(coalesce(new.note, ''), 4000);
  new.updated_at := now();
  return new;
end;
$$;

create trigger evaluation_scores_guard before insert or update or delete on public.evaluation_scores
  for each row execute function public.guard_evaluation_score();

create or replace function public.audit_evaluation_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  if new.score is not distinct from old.score then
    return null;  -- note-only edits are not score changes
  end if;
  select team_id into v_team from public.evaluations where id = new.evaluation_id;
  perform public._audit('score.changed', 'evaluation_score',
    new.evaluation_id::text || ':' || new.criterion_id, v_team, new.evaluation_id,
    jsonb_build_object('criterion_id', new.criterion_id,
      'criterion', (select title from public.rubric_criteria where id = new.criterion_id),
      'old_score', old.score, 'new_score', new.score));
  return null;
end;
$$;

create trigger evaluation_scores_audit after update on public.evaluation_scores
  for each row execute function public.audit_evaluation_score();

-- ---------------------------------------------------------------------------
-- Server-side score calculation (never trusted from the client)
-- ---------------------------------------------------------------------------
create or replace function public._recompute_evaluation(p_evaluation_id uuid)
returns public.evaluations language plpgsql security definer set search_path = public as $$
declare
  v_row public.evaluations%rowtype;
  v_template public.rubric_templates%rowtype;
begin
  update public.evaluations e set
    core_total = coalesce((
      select sum(s.score) from public.evaluation_scores s
      join public.rubric_criteria c on c.id = s.criterion_id
      where s.evaluation_id = e.id and not c.is_bonus), 0),
    bonus_total = coalesce((
      select sum(s.score) from public.evaluation_scores s
      join public.rubric_criteria c on c.id = s.criterion_id
      where s.evaluation_id = e.id and c.is_bonus), 0),
    core_scored_count = (
      select count(*) from public.evaluation_scores s
      join public.rubric_criteria c on c.id = s.criterion_id
      where s.evaluation_id = e.id and not c.is_bonus and s.score is not null),
    core_criteria_count = (
      select count(*) from public.rubric_criteria c
      where c.template_id = e.template_id and not c.is_bonus)
  where e.id = p_evaluation_id
  returning * into v_row;

  select * into v_template from public.rubric_templates where id = v_row.template_id;
  if v_row.core_total > v_template.core_max or v_row.bonus_total > v_template.bonus_max then
    raise exception 'Calculated totals exceed rubric maximums' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: start (or resume) an evaluation — idempotent
-- ---------------------------------------------------------------------------
create or replace function public.start_evaluation(p_team_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_template text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_assigned_judge(p_team_id) then
    raise exception 'You are not an approved judge assigned to this team' using errcode = '42501';
  end if;

  select c.template_id into v_template
  from public.teams t
  join public.levels l on l.code = t.level_code
  join public.competitions c on c.code = l.competition_code
  where t.id = p_team_id;

  insert into public.evaluations (team_id, judge_id, template_id)
  values (p_team_id, v_uid, v_template)
  on conflict (team_id, judge_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.evaluations where team_id = p_team_id and judge_id = v_uid;
  else
    insert into public.evaluation_scores (evaluation_id, criterion_id)
    select v_id, c.id from public.rubric_criteria c where c.template_id = v_template;
    perform public._recompute_evaluation(v_id);
    perform public._audit('evaluation.created', 'evaluation', v_id::text, p_team_id, v_id,
      jsonb_build_object('template_id', v_template));
  end if;

  return v_id;
end;
$$;

-- Apply a batch of row changes. p_scores = [{criterion_id, score|null, note}]
create or replace function public._apply_evaluation_changes(
  p_eval public.evaluations,
  p_scores jsonb,
  p_section_notes jsonb,
  p_overall_notes text
) returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if p_scores is not null then
    if jsonb_typeof(p_scores) <> 'array' then
      raise exception 'scores must be an array' using errcode = '22023';
    end if;
    for r in
      select a.elem ->> 'criterion_id' as criterion_id,
             a.elem -> 'score' as score,
             a.elem ->> 'note' as note,
             a.elem as elem
      from jsonb_array_elements(p_scores) as a(elem)
    loop
      if r.criterion_id is null then
        raise exception 'criterion_id is required' using errcode = '22023';
      end if;
      if r.score is not null and jsonb_typeof(r.score) <> 'null' then
        if jsonb_typeof(r.score) <> 'number'
           or (r.score::text)::numeric not in (1, 2, 3, 4, 5) then
          raise exception 'Score for % must be a whole number from 1 to 5', r.criterion_id using errcode = '22023';
        end if;
      end if;
      if not exists (select 1 from public.evaluation_scores
                     where evaluation_id = p_eval.id and criterion_id = r.criterion_id) then
        raise exception 'Criterion % is not part of this rubric', r.criterion_id using errcode = '22023';
      end if;

      update public.evaluation_scores s set
        score = case when r.elem ? 'score'
                     then (case when jsonb_typeof(r.score) = 'number' then (r.score::text)::numeric::smallint end)
                     else s.score end,
        note  = case when r.elem ? 'note' then coalesce(r.note, '') else s.note end
      where s.evaluation_id = p_eval.id and s.criterion_id = r.criterion_id
        and (
          (r.elem ? 'score' and s.score is distinct from (case when jsonb_typeof(r.score) = 'number' then (r.score::text)::numeric::smallint end))
          or (r.elem ? 'note' and s.note is distinct from coalesce(r.note, ''))
        );
    end loop;
  end if;

  if p_section_notes is not null then
    if jsonb_typeof(p_section_notes) <> 'object' then
      raise exception 'section_notes must be an object' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_each(p_section_notes) kv
      where kv.key not in (select id from public.rubric_sections where template_id = p_eval.template_id)
         or jsonb_typeof(kv.value) <> 'string'
    ) then
      raise exception 'Invalid section note' using errcode = '22023';
    end if;
    update public.evaluations
      set section_notes = section_notes || p_section_notes
      where id = p_eval.id and section_notes is distinct from (section_notes || p_section_notes);
  end if;

  if p_overall_notes is not null then
    update public.evaluations set overall_notes = left(p_overall_notes, 8000)
      where id = p_eval.id and overall_notes is distinct from left(p_overall_notes, 8000);
  end if;
end;
$$;

create or replace function public._lock_own_evaluation(p_evaluation_id uuid)
returns public.evaluations language plpgsql security definer set search_path = public as $$
declare
  v_eval public.evaluations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_eval from public.evaluations where id = p_evaluation_id for update;
  if not found or v_eval.judge_id <> auth.uid() then
    raise exception 'Evaluation not found' using errcode = '42501';
  end if;
  if not public.is_assigned_judge(v_eval.team_id) then
    raise exception 'You are no longer an approved judge assigned to this team' using errcode = '42501';
  end if;
  return v_eval;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: save a draft (auto-save)
-- ---------------------------------------------------------------------------
create or replace function public.save_evaluation(
  p_evaluation_id uuid,
  p_scores jsonb default null,
  p_section_notes jsonb default null,
  p_overall_notes text default null
) returns public.evaluations language plpgsql security definer set search_path = public as $$
declare
  v_eval public.evaluations%rowtype;
begin
  v_eval := public._lock_own_evaluation(p_evaluation_id);
  if v_eval.status = 'submitted' then
    raise exception 'This evaluation has been submitted and is locked' using errcode = 'P0001';
  end if;
  perform public._apply_evaluation_changes(v_eval, p_scores, p_section_notes, p_overall_notes);
  return public._recompute_evaluation(v_eval.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: submit — validates completeness, idempotent on repeat calls
-- ---------------------------------------------------------------------------
create or replace function public.submit_evaluation(
  p_evaluation_id uuid,
  p_scores jsonb default null,
  p_section_notes jsonb default null,
  p_overall_notes text default null
) returns public.evaluations language plpgsql security definer set search_path = public as $$
declare
  v_eval public.evaluations%rowtype;
  v_missing int;
begin
  v_eval := public._lock_own_evaluation(p_evaluation_id);
  if v_eval.status = 'submitted' then
    return v_eval;  -- repeated submit: no-op, never a duplicate result
  end if;

  perform public._apply_evaluation_changes(v_eval, p_scores, p_section_notes, p_overall_notes);
  v_eval := public._recompute_evaluation(v_eval.id);

  v_missing := v_eval.core_criteria_count - v_eval.core_scored_count;
  if v_missing > 0 then
    raise exception 'Evaluation is incomplete: % core criteria still need a score', v_missing
      using errcode = 'P0001';
  end if;

  update public.evaluations
    set status = 'submitted', submitted_at = now()
    where id = v_eval.id
    returning * into v_eval;

  perform public._audit('evaluation.submitted', 'evaluation', v_eval.id::text, v_eval.team_id, v_eval.id,
    jsonb_build_object('core_total', v_eval.core_total, 'bonus_total', v_eval.bonus_total));
  return v_eval;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC (admin): reopen a submitted evaluation
-- ---------------------------------------------------------------------------
create or replace function public.admin_reopen_evaluation(p_evaluation_id uuid, p_reason text)
returns public.evaluations language plpgsql security definer set search_path = public as $$
declare
  v_eval public.evaluations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to reopen an evaluation' using errcode = '22023';
  end if;
  select * into v_eval from public.evaluations where id = p_evaluation_id for update;
  if not found then
    raise exception 'Evaluation not found' using errcode = 'P0002';
  end if;
  if v_eval.status = 'draft' then
    return v_eval;
  end if;
  update public.evaluations
    set status = 'draft', submitted_at = null, reopened_count = reopened_count + 1
    where id = p_evaluation_id
    returning * into v_eval;
  perform public._audit('evaluation.reopened', 'evaluation', v_eval.id::text, v_eval.team_id, v_eval.id,
    jsonb_build_object('reason', btrim(p_reason), 'core_total', v_eval.core_total, 'bonus_total', v_eval.bonus_total));
  return v_eval;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC (admin): replace a team's judge assignments
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_team_judges(p_team_id uuid, p_judge_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  delete from public.team_judges
    where team_id = p_team_id and not (judge_id = any (coalesce(p_judge_ids, '{}')));
  insert into public.team_judges (team_id, judge_id, assigned_by)
    select p_team_id, j, auth.uid() from unnest(coalesce(p_judge_ids, '{}')) as j
    on conflict (team_id, judge_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC (admin): publish / unpublish a competition leaderboard
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_publication(p_competition text, p_published boolean)
returns public.competitions language plpgsql security definer set search_path = public as $$
declare
  v_row public.competitions%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.competitions set
    is_published = p_published,
    published_at = case when p_published then now() else null end,
    published_by = case when p_published then auth.uid() else null end
  where code = p_competition
  returning * into v_row;
  if not found then
    raise exception 'Unknown competition %', p_competition using errcode = 'P0002';
  end if;
  perform public._audit(case when p_published then 'leaderboard.published' else 'leaderboard.unpublished' end,
    'competition', p_competition);
  perform public._bump_signal(p_competition);
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC (admin): bulk import teams (atomic: all rows valid or nothing written)
-- p_rows: [{team_code, name, project_name, level_code, governorate, judge_emails: [..]}]
-- ---------------------------------------------------------------------------
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

  -- pass 1: validate everything
  for r in
    select ord::int as rownum, btrim(coalesce(e ->> 'team_code', '')) as team_code,
           btrim(coalesce(e ->> 'name', '')) as name,
           btrim(coalesce(e ->> 'project_name', '')) as project_name,
           btrim(coalesce(e ->> 'level_code', '')) as level_code,
           btrim(coalesce(e ->> 'governorate', '')) as governorate,
           coalesce(e -> 'judge_emails', '[]'::jsonb) as judge_emails
    from jsonb_array_elements(p_rows) with ordinality as a(e, ord)
  loop
    if r.team_code = '' then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', 'Team ID is required');
    end if;
    if r.name = '' then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', 'Team name is required');
    end if;
    if r.project_name = '' then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', 'Project name is required');
    end if;
    if not exists (select 1 from public.levels where code = r.level_code) then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Unknown organization / grade-level "%s"', r.level_code));
    end if;
    if not exists (select 1 from public.governorates where lower(code) = lower(r.governorate) or lower(name) = lower(r.governorate)) then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Unknown governorate "%s"', r.governorate));
    end if;
    select count(*) into v_n from jsonb_array_elements(p_rows) x
      where lower(btrim(x ->> 'team_code')) = lower(r.team_code);
    if r.team_code <> '' and v_n > 1 then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Team ID "%s" appears more than once in the file', r.team_code));
    end if;
    if jsonb_typeof(r.judge_emails) <> 'array' then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', 'judge_emails must be a list');
    else
      for v_email in select lower(btrim(x)) from jsonb_array_elements_text(r.judge_emails) x where btrim(x) <> '' loop
        if not exists (select 1 from public.profiles where lower(email) = v_email and status = 'approved') then
          v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Judge "%s" is not an approved account', v_email));
        end if;
      end loop;
    end if;
    if exists (
      select 1 from public.teams t
      join public.levels lo on lo.code = t.level_code
      join public.competitions co on co.code = lo.competition_code
      join public.levels ln on ln.code = r.level_code
      join public.competitions cn on cn.code = ln.competition_code
      where lower(t.team_code) = lower(r.team_code)
        and co.template_id <> cn.template_id
        and exists (select 1 from public.evaluations e where e.team_id = t.id)
    ) then
      v_errors := v_errors || jsonb_build_object('row', r.rownum, 'message', format('Team "%s" already has evaluations; its rubric cannot change', r.team_code));
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors, 'inserted', 0, 'updated', 0, 'assignments_added', 0);
  end if;

  -- pass 2: write
  for r in
    select btrim(e ->> 'team_code') as team_code, btrim(e ->> 'name') as name,
           btrim(e ->> 'project_name') as project_name, btrim(e ->> 'level_code') as level_code,
           btrim(e ->> 'governorate') as governorate,
           coalesce(e -> 'judge_emails', '[]'::jsonb) as judge_emails
    from jsonb_array_elements(p_rows) a(e)
  loop
    select code into v_gov from public.governorates
      where lower(code) = lower(r.governorate) or lower(name) = lower(r.governorate) limit 1;
    select id into v_team_id from public.teams where lower(team_code) = lower(r.team_code);
    v_existed := v_team_id is not null;
    if v_existed then
      update public.teams set name = r.name, project_name = r.project_name,
        level_code = r.level_code, governorate_code = v_gov
      where id = v_team_id
        and (name, project_name, level_code, governorate_code) is distinct from (r.name, r.project_name, r.level_code, v_gov);
      v_updated := v_updated + 1;
    else
      insert into public.teams (team_code, name, project_name, level_code, governorate_code, created_by)
      values (r.team_code, r.name, r.project_name, r.level_code, v_gov, auth.uid())
      returning id into v_team_id;
      v_inserted := v_inserted + 1;
    end if;

    select coalesce(array_agg(p.id), '{}') into v_judges
      from public.profiles p
      where lower(p.email) in (select lower(btrim(x)) from jsonb_array_elements_text(r.judge_emails) x);

    if p_replace_assignments then
      delete from public.team_judges where team_id = v_team_id and not (judge_id = any (v_judges));
    end if;
    foreach v_judge in array v_judges loop
      insert into public.team_judges (team_id, judge_id, assigned_by)
      values (v_team_id, v_judge, auth.uid())
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_assigned := v_assigned + v_n;
    end loop;
  end loop;

  perform public._audit('teams.imported', 'team', null, null, null,
    jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'assignments_added', v_assigned,
                       'replace_assignments', p_replace_assignments));
  return jsonb_build_object('ok', true, 'errors', '[]'::jsonb, 'inserted', v_inserted,
                            'updated', v_updated, 'assignments_added', v_assigned);
end;
$$;

-- ---------------------------------------------------------------------------
-- Results: per-team aggregation (internal)
--   * required judges = judges currently assigned to the team
--   * only submitted evaluations of currently-assigned judges count
--   * a team is complete when every required judge has submitted
--   * avg_core / avg_bonus are the arithmetic means, kept separate
-- ---------------------------------------------------------------------------
create or replace function public._team_results()
returns table (
  team_id uuid, team_code text, team_name text, project_name text,
  organization public.organization_code, competition_code text, competition_label text,
  competition_sort int, is_published boolean,
  level_code text, level_label text, governorate_code text, governorate_name text,
  judges_required int, judges_submitted int, is_complete boolean,
  avg_core numeric, avg_bonus numeric, provisional_core numeric, provisional_bonus numeric
) language sql stable security definer set search_path = public as $$
  select
    t.id, t.team_code, t.name, t.project_name,
    c.organization, c.code, c.label, c.sort_order, c.is_published,
    l.code, l.label, g.code, g.name,
    coalesce(a.required, 0), coalesce(s.submitted, 0),
    (coalesce(a.required, 0) > 0 and coalesce(s.submitted, 0) = coalesce(a.required, 0)),
    case when coalesce(a.required, 0) > 0 and coalesce(s.submitted, 0) = coalesce(a.required, 0) then s.avg_core end,
    case when coalesce(a.required, 0) > 0 and coalesce(s.submitted, 0) = coalesce(a.required, 0) then s.avg_bonus end,
    s.avg_core, s.avg_bonus
  from public.teams t
  join public.levels l on l.code = t.level_code
  join public.competitions c on c.code = l.competition_code
  join public.governorates g on g.code = t.governorate_code
  left join lateral (
    select count(*)::int as required from public.team_judges tj where tj.team_id = t.id
  ) a on true
  left join lateral (
    select count(*)::int as submitted,
           avg(e.core_total)::numeric as avg_core,
           avg(e.bonus_total)::numeric as avg_bonus
    from public.evaluations e
    join public.team_judges tj on tj.team_id = e.team_id and tj.judge_id = e.judge_id
    where e.team_id = t.id and e.status = 'submitted'
  ) s on true;
$$;

-- ---------------------------------------------------------------------------
-- RPC: leaderboard (public for published competitions; admins see all)
-- Ties share a rank (standard competition ranking). No tie-break is applied.
-- ---------------------------------------------------------------------------
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
declare
  v_admin boolean := public.is_admin();
begin
  return query
  with base as (
    select r.*, round(r.avg_core, 6) as sort_core
    from public._team_results() r
    where r.is_complete
      and (v_admin or r.is_published)
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

-- Public list of which leaderboards are published (for the public page)
create or replace function public.get_competitions()
returns table (code text, organization public.organization_code, label text, sort_order int,
               is_published boolean, published_at timestamptz, template_id text)
language sql stable security definer set search_path = public as $$
  select c.code, c.organization, c.label, c.sort_order, c.is_published, c.published_at, c.template_id
  from public.competitions c order by c.sort_order;
$$;

-- ---------------------------------------------------------------------------
-- RPC (admin): full team progress incl. pending teams
-- ---------------------------------------------------------------------------
create or replace function public.admin_team_results()
returns table (
  team_id uuid, team_code text, team_name text, project_name text,
  organization public.organization_code, competition_code text, competition_label text,
  competition_sort int, is_published boolean,
  level_code text, level_label text, governorate_code text, governorate_name text,
  judges_required int, judges_submitted int, is_complete boolean,
  avg_core numeric, avg_bonus numeric, provisional_core numeric, provisional_bonus numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return query select * from public._team_results() r order by r.competition_sort, r.team_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC (admin): dashboard statistics
-- ---------------------------------------------------------------------------
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
        from public.levels l left join r on r.level_code = l.code
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
