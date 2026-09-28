-- =============================================================================
-- Row Level Security, privileges and realtime
-- =============================================================================

alter table public.profiles          enable row level security;
alter table public.governorates      enable row level security;
alter table public.score_levels      enable row level security;
alter table public.rubric_templates  enable row level security;
alter table public.rubric_sections   enable row level security;
alter table public.rubric_criteria   enable row level security;
alter table public.competitions      enable row level security;
alter table public.levels            enable row level security;
alter table public.teams             enable row level security;
alter table public.team_judges       enable row level security;
alter table public.evaluations       enable row level security;
alter table public.evaluation_scores enable row level security;
alter table public.audit_log         enable row level security;
alter table public.results_signal    enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges: start from nothing, grant only what is needed.
-- (Supabase grants ALL to anon/authenticated by default.)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.governorates, public.competitions, public.levels, public.results_signal to anon, authenticated;
grant select on public.score_levels, public.rubric_templates, public.rubric_sections, public.rubric_criteria to authenticated;
grant select, update (full_name, role, status) on public.profiles to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, delete on public.team_judges to authenticated;
grant select on public.evaluations, public.evaluation_scores, public.audit_log to authenticated;
-- NOTE: no INSERT/UPDATE/DELETE on evaluations / evaluation_scores for any client
-- role: every change goes through the validated RPCs below.

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- profiles: users see themselves; admins see and manage everyone.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));   -- role/status changes blocked by trigger
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- reference data: readable
create policy governorates_read on public.governorates for select to anon, authenticated using (true);
create policy competitions_read on public.competitions for select to anon, authenticated using (true);
create policy levels_read on public.levels for select to anon, authenticated using (true);
create policy results_signal_read on public.results_signal for select to anon, authenticated using (true);
create policy score_levels_read on public.score_levels for select to authenticated using (true);
create policy rubric_templates_read on public.rubric_templates for select to authenticated using (true);
create policy rubric_sections_read on public.rubric_sections for select to authenticated using (true);
create policy rubric_criteria_read on public.rubric_criteria for select to authenticated using (true);

-- teams: admins manage; approved judges see only their assigned teams
create policy teams_select on public.teams for select to authenticated
  using ((select public.is_admin()) or public.is_assigned_judge(id));
create policy teams_insert on public.teams for insert to authenticated
  with check ((select public.is_admin()));
create policy teams_update on public.teams for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy teams_delete on public.teams for delete to authenticated
  using ((select public.is_admin()));

-- assignments: admins manage; judges see their own rows
create policy team_judges_select on public.team_judges for select to authenticated
  using ((select public.is_admin()) or (judge_id = (select auth.uid()) and (select public.is_approved_user())));
create policy team_judges_insert on public.team_judges for insert to authenticated
  with check ((select public.is_admin()));
create policy team_judges_delete on public.team_judges for delete to authenticated
  using ((select public.is_admin()));

-- evaluations: a judge can read only their own; admins read all
create policy evaluations_select on public.evaluations for select to authenticated
  using ((select public.is_admin()) or (judge_id = (select auth.uid()) and (select public.is_approved_user())));

create policy evaluation_scores_select on public.evaluation_scores for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.evaluations e
      where e.id = evaluation_id and e.judge_id = (select auth.uid())
    ) and (select public.is_approved_user())
  );

-- audit log: admins only
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

-- used inside RLS policies
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_approved_user() to anon, authenticated;
grant execute on function public.is_assigned_judge(uuid) to anon, authenticated;

-- public endpoints (return only published, complete results to non-admins)
grant execute on function public.get_leaderboard(text, text, text, text) to anon, authenticated;
grant execute on function public.get_competitions() to anon, authenticated;

-- judge endpoints
grant execute on function public.start_evaluation(uuid) to authenticated;
grant execute on function public.save_evaluation(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.submit_evaluation(uuid, jsonb, jsonb, text) to authenticated;

-- admin endpoints (each checks is_admin() internally)
grant execute on function public.admin_reopen_evaluation(uuid, text) to authenticated;
grant execute on function public.admin_set_team_judges(uuid, uuid[]) to authenticated;
grant execute on function public.admin_set_publication(text, boolean) to authenticated;
grant execute on function public.admin_import_teams(jsonb, boolean) to authenticated;
grant execute on function public.admin_team_results() to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- trigger functions & internal helpers stay non-executable for clients
-- (_team_results, _recompute_evaluation, _apply_evaluation_changes, _audit, ...)

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: clients subscribe to results_signal to refresh leaderboards
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.results_signal';
  end if;
end;
$$;
