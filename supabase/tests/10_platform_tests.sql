-- =============================================================================
-- End-to-end database tests: authorization, independent judging, averaging,
-- idempotent submission, pending exclusion, DEMI/DECI separation, publication,
-- audit trail, import validation. Run via scripts/test_db.sh on a scratch DB.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.uid(p text) returns uuid language sql immutable as $$
  select (case p
    when 'admin' then '00000000-0000-0000-0000-00000000000a'
    when 'j1'    then '00000000-0000-0000-0000-000000000001'
    when 'j2'    then '00000000-0000-0000-0000-000000000002'
    when 'j3'    then '00000000-0000-0000-0000-000000000003'
    when 'jp'    then '00000000-0000-0000-0000-00000000000f'
  end)::uuid $$;

create function tests.login(p text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', tests.uid(p), 'role', 'authenticated')::text, false)::text; $$;

create function tests.logout() returns void language sql as $$
  select set_config('request.jwt.claims', '', false)::text; $$;

create function tests.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

create function tests.throws(p_sql text, p_pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ~* p_pattern then raise notice 'ok - % (%)', msg, sqlerrm; return; end if;
    raise exception 'ASSERTION FAILED: % — wrong error: %', msg, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % — expected an error', msg;
end $$;

-- helper: build a scores payload for an evaluation
-- p_core: array of 20 scores (null allowed), p_bonus: array of bonus scores
create function tests.payload(p_template text, p_core int[], p_bonus int[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('criterion_id', id, 'score', sc, 'note', 'note for ' || id)), '[]')
  from (
    select c.id,
      case when c.is_bonus then p_bonus[row_number() over (partition by c.is_bonus order by s.position, c.position)]
           else p_core[row_number() over (partition by c.is_bonus order by s.position, c.position)] end as sc
    from public.rubric_criteria c join public.rubric_sections s on s.id = c.section_id
    where c.template_id = p_template
  ) x $$;

grant execute on all functions in schema tests to anon, authenticated;

-- helper: 15 fives + 5 twos = 85 ; 15 fives + 5 fours = 95 ; 18 x5 = 90
create function tests.arr(n5 int, other int, n_other int) returns int[] language sql immutable as $$
  select array_cat(array_fill(5, array[n5]), array_fill(other, array[n_other])) $$;
grant execute on function tests.arr(int,int,int) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 0. Rubric integrity in the database
-- -----------------------------------------------------------------------------
select tests.ok((select count(*) from rubric_templates) = 6, 'six rubric templates');
select tests.ok((select bool_and(core_max = 100) from rubric_templates), 'every rubric core total is 100');
select tests.ok((select count(*) from rubric_criteria where not is_bonus) = 120, '6 x 20 core criteria');
select tests.ok((select bonus_max from rubric_templates where id = 'DECI_L45') = 15, 'L4&5 bonus max 15 as in PDF');
select tests.ok((select count(*) from rubric_templates where id <> 'DECI_L45' and bonus_max = 10) = 5, 'other bonus max 10');
select tests.ok(not exists (
  select 1 from rubric_sections s where weight <> (select count(*)*5 from rubric_criteria c where c.section_id = s.id)
), 'every section weight = rows x 5');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DEMI_G4' and not is_bonus) = '20,15,25,15,10,15', 'G4 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DEMI_G5' and not is_bonus) = '15,25,20,15,10,15', 'G5 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DECI_L1' and not is_bonus) = '15,20,20,15,10,5,15', 'L1 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DECI_L2' and not is_bonus) = '15,25,15,15,10,5,15', 'L2 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DECI_L3' and not is_bonus) = '15,25,20,10,10,5,15', 'L3 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DECI_L45' and not is_bonus) = '10,25,20,15,15,15', 'L4&5 weights');
select tests.ok((select count(*) from governorates) = 5, 'five governorates');
select tests.ok((select string_agg(template_id, ',' order by l.code) from levels l join competitions c on c.code = l.competition_code where l.code in ('L4','L5')) = 'DECI_L45,DECI_L45', 'L4 and L5 share the combined rubric');

-- -----------------------------------------------------------------------------
-- 1. Sign-up creates pending judges; bootstrap admin
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  (tests.uid('admin'), 'admin@example.com', '{"full_name":"Ada Admin"}'),
  (tests.uid('j1'), 'judge1@example.com', '{"full_name":"Judge One"}'),
  (tests.uid('j2'), 'judge2@example.com', '{"full_name":"Judge Two"}'),
  (tests.uid('j3'), 'judge3@example.com', '{"full_name":"Judge Three"}'),
  (tests.uid('jp'), 'pending@example.com', '{"full_name":"Pending Person"}');

select tests.ok((select count(*) from profiles where role = 'judge' and status = 'pending') = 5, 'new sign-ups are pending judges');
update profiles set role = 'admin', status = 'approved' where email = 'admin@example.com'; -- SQL editor bootstrap

-- pending user cannot self-approve or self-promote
select tests.login('jp'); set role authenticated;
select tests.throws($$update profiles set status = 'approved' where id = auth.uid()$$, 'Only administrators', 'pending judge cannot self-approve');
select tests.throws($$update profiles set role = 'admin' where id = auth.uid()$$, 'Only administrators', 'judge cannot self-promote');
select tests.ok((select count(*) from profiles) = 1, 'user sees only own profile');
update profiles set full_name = 'Pending P.' where id = auth.uid();
select tests.ok((select full_name from profiles where id = auth.uid()) = 'Pending P.', 'user can edit own name');
select tests.throws($$select public.admin_dashboard_stats()$$, 'Administrator access required', 'non-admin blocked from admin stats');
reset role;

-- admin approves judges
select tests.login('admin'); set role authenticated;
update profiles set status = 'approved' where email in ('judge1@example.com','judge2@example.com','judge3@example.com');
select tests.ok((select count(*) from profiles where status = 'approved' and role = 'judge') = 3, 'admin approved three judges');
select tests.throws($$update profiles set role = 'judge' where id = auth.uid()$$, 'last active administrator', 'last admin cannot demote self');

-- pending judge cannot be assigned
insert into teams (team_code, name, project_name, level_code, governorate_code) values
  ('T1', 'Team One', 'Water Saver', 'G4', 'CAI'),
  ('T2', 'Team Two', 'Smart Bin', 'G4', 'ALX'),
  ('T3', 'Team Three', 'Crop Watch', 'L4', 'AST'),
  ('T4', 'Team Four', 'Safe Home', 'L5', 'SUZ'),
  ('T5', 'Team Five', 'Robo Arm', 'L1', 'MNF'),
  ('T6', 'Team Six', 'Health Band', 'G5', 'CAI');
select tests.throws($$insert into teams (team_code, name, project_name, level_code, governorate_code) values ('t1','dup','dup','G4','CAI')$$, 'duplicate key', 'team IDs are unique (case-insensitive)');
select tests.throws($$insert into team_judges (team_id, judge_id) select id, tests.uid('jp') from teams where team_code='T1'$$, 'Only approved', 'pending account cannot be assigned');

select admin_set_team_judges((select id from teams where team_code='T1'), array[tests.uid('j1'), tests.uid('j2')]);
select admin_set_team_judges((select id from teams where team_code='T2'), array[tests.uid('j1')]);
select admin_set_team_judges((select id from teams where team_code='T3'), array[tests.uid('j1'), tests.uid('j2')]);
select admin_set_team_judges((select id from teams where team_code='T4'), array[tests.uid('j2')]);
select admin_set_team_judges((select id from teams where team_code='T5'), array[tests.uid('j3')]);
select admin_set_team_judges((select id from teams where team_code='T6'), array[tests.uid('j3')]);
select tests.ok((select count(*) from team_judges) = 8, 'assignments created (multiple judges per team)');
reset role;

-- -----------------------------------------------------------------------------
-- 2. Judges see only assigned teams; pending users see nothing
-- -----------------------------------------------------------------------------
select tests.login('jp'); set role authenticated;
select tests.ok((select count(*) from teams) = 0, 'pending user sees no teams');
select tests.throws($$select start_evaluation((select id from teams limit 1))$$, 'not an approved judge|null value', 'pending user cannot start evaluations');
reset role;

select tests.login('j1'); set role authenticated;
select tests.ok((select string_agg(team_code, ',' order by team_code) from teams) = 'T1,T2,T3', 'judge 1 sees only assigned teams');
select tests.ok((select count(*) from team_judges) = 3, 'judge 1 sees only own assignments');
select tests.throws($$insert into teams (team_code, name, project_name, level_code, governorate_code) values ('X','x','x','G4','CAI')$$, 'row-level security|permission denied', 'judge cannot create teams');
select tests.throws($$insert into team_judges (team_id, judge_id) values ((select id from teams where team_code='T1'), tests.uid('j3'))$$, 'row-level security|permission denied', 'judge cannot assign judges');
reset role;

-- -----------------------------------------------------------------------------
-- 3. Drafts, validation, submission and idempotency (judge 1, team T1)
-- -----------------------------------------------------------------------------
select tests.login('j1'); set role authenticated;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;
insert into ids values ('e1', start_evaluation((select id from teams where team_code='T1')));
select tests.ok(start_evaluation((select id from teams where team_code='T1')) = (select v from ids where k='e1'), 'start_evaluation is idempotent (same evaluation id)');
select tests.ok((select count(*) from evaluations) = 1, 'only one evaluation row');
select tests.ok((select count(*) from evaluation_scores where evaluation_id = (select v from ids where k='e1')) = 22, 'G4 evaluation has 20 core + 2 bonus rows');
select tests.throws($$select start_evaluation((select id from public.teams where team_code='T4'))$$, 'not an approved judge', 'cannot evaluate an unassigned team (hidden id)');

-- partial draft
select save_evaluation((select v from ids where k='e1'), tests.payload('DEMI_G4', array[5,5,5,null], null), '{"DEMI_G4.S1":"section note"}', 'overall');
select tests.ok((select core_total from evaluations where id=(select v from ids where k='e1')) = 15, 'draft core subtotal computed server-side');
select tests.ok((select status::text from evaluations where id=(select v from ids where k='e1')) = 'draft', 'draft saved');
select tests.throws($$select submit_evaluation((select v from ids where k='e1'))$$, 'incomplete: 17 core criteria', 'incomplete evaluation cannot be submitted');
select tests.throws($$select save_evaluation((select v from ids where k='e1'), '[{"criterion_id":"DEMI_G4.S1.C1","score":6}]')$$, 'whole number from 1 to 5', 'score 6 rejected');
select tests.throws($$select save_evaluation((select v from ids where k='e1'), '[{"criterion_id":"DEMI_G4.S1.C1","score":0}]')$$, 'whole number from 1 to 5', 'score 0 rejected');
select tests.throws($$select save_evaluation((select v from ids where k='e1'), '[{"criterion_id":"DEMI_G4.S1.C1","score":3.5}]')$$, 'whole number from 1 to 5', 'fractional score rejected');
select tests.throws($$select save_evaluation((select v from ids where k='e1'), '[{"criterion_id":"DEMI_G4.S1.C1","score":"4"}]')$$, 'whole number from 1 to 5', 'string score rejected');
select tests.throws($$select save_evaluation((select v from ids where k='e1'), '[{"criterion_id":"DECI_L1.S1.C1","score":4}]')$$, 'not part of this rubric', 'criterion from another rubric rejected');
select tests.throws($$select save_evaluation((select v from ids where k='e1'), null, '{"DECI_L1.S1":"x"}')$$, 'Invalid section note', 'section note for foreign section rejected');
select tests.throws($$update evaluation_scores set score = 5$$, 'permission denied', 'direct score UPDATE denied');
select tests.throws($$insert into evaluations (team_id, judge_id, template_id) values ((select id from teams where team_code='T2'), auth.uid(), 'DEMI_G4')$$, 'permission denied', 'direct evaluation INSERT denied');
select tests.throws($$update evaluations set core_total = 100$$, 'permission denied', 'direct total tampering denied');

-- complete: 85 core, bonus 4 (one bonus row left blank = optional)
select submit_evaluation((select v from ids where k='e1'), tests.payload('DEMI_G4', tests.arr(15, 2, 5), array[4, null]));
select tests.ok((select core_total from evaluations where id=(select v from ids where k='e1')) = 85, 'judge 1 core = 85');
select tests.ok((select bonus_total from evaluations where id=(select v from ids where k='e1')) = 4, 'judge 1 bonus = 4 (kept separate)');
select tests.ok((select status::text from evaluations where id=(select v from ids where k='e1')) = 'submitted', 'submitted');
-- repeated submission (double click / retry)
select submit_evaluation((select v from ids where k='e1'), tests.payload('DEMI_G4', tests.arr(20, 5, 0), array[5, 5]));
select submit_evaluation((select v from ids where k='e1'));
select tests.ok((select count(*) from evaluations where team_id=(select id from teams where team_code='T1')) = 1, 'resubmission does not duplicate');
select tests.ok((select core_total from evaluations where id=(select v from ids where k='e1')) = 85, 'resubmission cannot alter a submitted score');
select tests.throws($$select save_evaluation((select v from ids where k='e1'), '[{"criterion_id":"DEMI_G4.S1.C1","score":1}]')$$, 'submitted and is locked', 'submitted evaluation locked for the judge');
reset role;

-- locked at table level too (even for the table owner)
select tests.throws($$update evaluation_scores set score = 1 where evaluation_id = (select v from ids where k='e1') and criterion_id = 'DEMI_G4.S1.C1'$$, 'locked', 'submitted scores locked by trigger');

-- -----------------------------------------------------------------------------
-- 4. Judges are isolated from each other
-- -----------------------------------------------------------------------------
select tests.login('j2'); set role authenticated;
select tests.ok((select count(*) from evaluations) = 0, 'judge 2 cannot see judge 1 evaluation');
select tests.ok((select count(*) from evaluation_scores) = 0, 'judge 2 cannot see judge 1 scores');
select tests.throws($$select save_evaluation((select v from ids where k='e1'), '[]')$$, 'Evaluation not found', 'judge 2 cannot write judge 1 evaluation');
select tests.throws($$select submit_evaluation((select v from ids where k='e1'))$$, 'Evaluation not found', 'judge 2 cannot submit judge 1 evaluation');

-- pending: T1 has 2 required judges, only 1 submitted
select tests.ok(not exists (select 1 from get_leaderboard() where team_code = 'T1'), 'pending team hidden from judges');
reset role;

select tests.login('admin'); set role authenticated;
select tests.ok(not exists (select 1 from get_leaderboard() where team_code = 'T1'), 'pending team not ranked even for admin');
select tests.ok((select judges_submitted = 1 and judges_required = 2 and not is_complete and avg_core is null and provisional_core = 85
                 from admin_team_results() where team_code = 'T1'), 'admin sees T1 pending 1/2 with no official score');
reset role;

-- judge 2 submits 95 on T1
select tests.login('j2'); set role authenticated;
insert into ids values ('e2', start_evaluation((select id from teams where team_code='T1')));
select tests.ok((select v from ids where k='e2') <> (select v from ids where k='e1'), 'separate evaluation per judge');
select submit_evaluation((select v from ids where k='e2'), tests.payload('DEMI_G4', tests.arr(15, 4, 5), array[5, 5]));
select tests.ok((select core_total from evaluations where id=(select v from ids where k='e2')) = 95, 'judge 2 core = 95');
reset role;

-- -----------------------------------------------------------------------------
-- 5. Averaging, ties, DEMI/DECI separation
-- -----------------------------------------------------------------------------
select tests.login('j1'); set role authenticated;
insert into ids values ('e3', start_evaluation((select id from teams where team_code='T2')));
select tests.throws($$select submit_evaluation((select v from ids where k='e3'), tests.payload('DEMI_G4', tests.arr(18, 0, 0) || array[null,null]::int[], null))$$, 'incomplete: 2 core', 'two blank core rows block submission');
reset role;
select tests.ok((select status::text from evaluations where id=(select v from ids where k='e3')) = 'draft', 'sanity: payload with 2 blanks not submitted');
select tests.login('j1'); set role authenticated;
select submit_evaluation((select v from ids where k='e3'), tests.payload('DEMI_G4', tests.arr(10, 4, 10), null)); -- 50+40 = 90
insert into ids values ('e4', start_evaluation((select id from teams where team_code='T3')));
select submit_evaluation((select v from ids where k='e4'), tests.payload('DECI_L45', tests.arr(16, 4, 4), array[5,5,5])); -- 96, bonus 15
reset role;
select tests.login('j2'); set role authenticated;
insert into ids values ('e5', start_evaluation((select id from teams where team_code='T3')));
select submit_evaluation((select v from ids where k='e5'), tests.payload('DECI_L45', tests.arr(10, 3, 10), array[1,null,null])); -- 80, bonus 1
insert into ids values ('e6', start_evaluation((select id from teams where team_code='T4')));
select submit_evaluation((select v from ids where k='e6'), tests.payload('DECI_L45', tests.arr(12, 4, 8), null)); -- 92
select tests.ok((select count(*) from evaluation_scores where evaluation_id=(select v from ids where k='e6')) = 23, 'L4&5 evaluation has 20 core + 3 bonus rows');
reset role;

select tests.login('admin'); set role authenticated;
select tests.ok((select avg_core from get_leaderboard() where team_code='T1') = 90.00, 'T1 average core = (85+95)/2 = 90');
select tests.ok((select avg_bonus from get_leaderboard() where team_code='T1') = 7.00, 'T1 average bonus = (4+10)/2 = 7, separate');
select tests.ok((select judges_submitted from get_leaderboard() where team_code='T1') = 2, 'T1 completed judges = 2');
select tests.ok((select string_agg(team_code || ':' || rank || ':' || is_tied, ',' order by team_code) from get_leaderboard(p_competition := 'DEMI_G4')) = 'T1:1:true,T2:1:true', 'equal averages share rank 1, no tie-break invented');
select tests.ok((select avg_core from get_leaderboard() where team_code='T3') = 88.00, 'T3 average (96+80)/2 = 88');
select tests.ok((select avg_bonus from get_leaderboard() where team_code='T3') = 8.00, 'T3 bonus (15+1)/2 = 8');
select tests.ok((select string_agg(team_code || ':' || level_code || ':' || rank, ',' order by rank) from get_leaderboard(p_competition := 'DECI_L45')) = 'T4:L5:1,T3:L4:2', 'L4 & L5 ranked together in combined category, keeping actual level');
select tests.ok((select string_agg(team_code, ',') from get_leaderboard(p_level := 'L4')) = 'T3', 'level filter L4 only');
select tests.ok((select rank from get_leaderboard(p_level := 'L4') where team_code='T3') = 1, 'rank recomputed within filtered view');
select tests.ok(not exists (select 1 from get_leaderboard(p_organization := 'DEMI') where organization <> 'DEMI'), 'DEMI filter returns only DEMI');
select tests.ok(not exists (select 1 from get_leaderboard(p_organization := 'DECI') where organization <> 'DECI'), 'DECI filter returns only DECI');
select tests.ok((select count(distinct competition_code) from get_leaderboard() where is_top) = 2, 'a top team is flagged per competition (DEMI_G4, DECI_L45)');
select tests.ok((select string_agg(team_code, ',') from get_leaderboard(p_governorate := 'CAI')) = 'T1', 'governorate filter');
select tests.ok(not exists (select 1 from get_leaderboard() where team_code in ('T5','T6')), 'teams without submissions not listed');
select tests.ok((select (s->>'completed_evaluations')::int = 6 and (s->>'pending_evaluations')::int = 2 and (s->>'total_teams')::int = 6 and (s->>'total_judges')::int = 3 from admin_dashboard_stats() s), 'dashboard counts');
reset role;

-- -----------------------------------------------------------------------------
-- 6. Publication control (anon & judges only see published boards)
-- -----------------------------------------------------------------------------
select tests.logout(); set role anon;
select tests.ok((select count(*) from get_leaderboard()) = 0, 'anon sees nothing before publication');
select tests.throws($$select * from teams$$, 'permission denied', 'anon cannot read teams');
select tests.throws($$select * from evaluations$$, 'permission denied', 'anon cannot read evaluations');
select tests.throws($$select * from rubric_criteria$$, 'permission denied', 'anon cannot read rubric tables');
select tests.throws($$select * from public._team_results()$$, 'permission denied', 'internal results function not callable');
select tests.throws($$select admin_set_publication('DEMI_G4', true)$$, 'permission denied|Administrator', 'anon cannot publish');
reset role;

select tests.login('j3'); set role authenticated;
select tests.throws($$select admin_set_publication('DEMI_G4', true)$$, 'Administrator access required', 'judge cannot publish');
select tests.throws($$select admin_reopen_evaluation((select v from ids where k='e1'), 'x')$$, 'Administrator access required', 'judge cannot reopen');
select tests.throws($$select admin_team_results()$$, 'Administrator access required', 'judge cannot read all results');
reset role;

select tests.login('admin'); set role authenticated;
select (select version from results_signal where competition_code='DEMI_G4') as v_before \gset
select admin_set_publication('DEMI_G4', true);
reset role;
select tests.ok((select version from results_signal where competition_code='DEMI_G4') > :v_before, 'publishing bumps the realtime signal');

select tests.logout(); set role anon;
select tests.ok((select string_agg(team_code, ',' order by team_code) from get_leaderboard()) = 'T1,T2', 'anon sees only the published DEMI Grade 4 board');
reset role;

-- -----------------------------------------------------------------------------
-- 7. Reopen / audit / newly assigned judge => team returns to pending
-- -----------------------------------------------------------------------------
select tests.login('admin'); set role authenticated;
select tests.throws($$select admin_reopen_evaluation((select v from ids where k='e2'), '  ')$$, 'reason is required', 'reopen requires a reason');
select admin_reopen_evaluation((select v from ids where k='e2'), 'Judge requested correction');
select tests.ok(not exists (select 1 from get_leaderboard() where team_code='T1'), 'reopened team drops out of rankings');
reset role;
select tests.login('j2'); set role authenticated;
select save_evaluation((select v from ids where k='e2'), '[{"criterion_id":"DEMI_G4.S1.C1","score":4}]');
select submit_evaluation((select v from ids where k='e2'));
reset role;
select tests.login('admin'); set role authenticated;
select tests.ok((select avg_core from get_leaderboard() where team_code='T1') = 89.50, 'corrected score (85+94)/2 = 89.5 recalculated');
select tests.ok((select count(*) from audit_log where action = 'score.changed' and evaluation_id = (select v from ids where k='e2') and (details->>'old_score')::int = 5 and (details->>'new_score')::int = 4) = 1, 'score change audited with old/new values');
select tests.ok((select count(*) from audit_log where action = 'evaluation.reopened' and details->>'reason' = 'Judge requested correction') = 1, 'reopen audited with reason');
select tests.ok((select count(*) from audit_log where action = 'evaluation.submitted' and evaluation_id = (select v from ids where k='e2')) = 2, 'both submissions audited');

select admin_set_team_judges((select id from teams where team_code='T1'), array[tests.uid('j1'), tests.uid('j2'), tests.uid('j3')]);
select tests.ok(not exists (select 1 from get_leaderboard() where team_code='T1'), 'adding a third required judge makes T1 pending again');
select tests.ok((select judges_required from admin_team_results() where team_code='T1') = 3, 'any number of judges supported');
select admin_set_team_judges((select id from teams where team_code='T1'), array[tests.uid('j1'), tests.uid('j2')]);
select tests.ok(exists (select 1 from get_leaderboard() where team_code='T1'), 'removing the extra judge restores T1');

-- rubric change blocked once evaluated; L4 <-> L5 allowed (same rubric)
select tests.throws($$update teams set level_code = 'G5' where team_code = 'T1'$$, 'cannot move to a different rubric', 'cannot move evaluated team to another rubric');
update teams set level_code = 'L5' where team_code = 'T3';
select tests.ok((select level_code from get_leaderboard() where team_code='T3') = 'L5', 'L4 -> L5 allowed: same shared rubric');
update teams set level_code = 'L4' where team_code = 'T3';
select tests.throws($$delete from teams where team_code = 'T1'$$, 'foreign key|violates', 'evaluated team cannot be deleted accidentally');

-- -----------------------------------------------------------------------------
-- 8. Bulk import: atomic validation
-- -----------------------------------------------------------------------------
select tests.ok((select (r->>'ok')::boolean = false and jsonb_array_length(r->'errors') >= 3 from admin_import_teams('[
  {"team_code":"N1","name":"New One","project_name":"P1","level_code":"G4","governorate":"Cairo","judge_emails":["judge1@example.com"]},
  {"team_code":"N2","name":"","project_name":"P2","level_code":"G9","governorate":"Giza","judge_emails":["nobody@example.com"]}
]'::jsonb) r), 'invalid import reports row errors');
select tests.ok(not exists (select 1 from teams where team_code = 'N1'), 'invalid import writes nothing (atomic)');
select tests.ok((select (r->>'ok')::boolean and (r->>'inserted')::int = 2 and (r->>'updated')::int = 1 and (r->>'assignments_added')::int = 3 from admin_import_teams('[
  {"team_code":"N1","name":"New One","project_name":"P1","level_code":"G4","governorate":"cairo","judge_emails":["JUDGE1@example.com","judge2@example.com"]},
  {"team_code":"N2","name":"New Two","project_name":"P2","level_code":"L5","governorate":"SUZ","judge_emails":["judge3@example.com"]},
  {"team_code":"T5","name":"Team Five","project_name":"Robo Arm v2","level_code":"L1","governorate":"MNF","judge_emails":[]}
]'::jsonb) r), 'valid import inserts/updates teams and assigns judges');
select tests.ok((select project_name from teams where team_code='T5') = 'Robo Arm v2', 'import upserts by team ID');
select tests.ok((select (r->>'ok')::boolean = false from admin_import_teams('[
  {"team_code":"D1","name":"a","project_name":"b","level_code":"G4","governorate":"CAI"},
  {"team_code":"d1","name":"a","project_name":"b","level_code":"G4","governorate":"CAI"}]'::jsonb) r), 'duplicate IDs inside a file rejected');
reset role;

-- -----------------------------------------------------------------------------
-- 9. Disabled judges lose access immediately
-- -----------------------------------------------------------------------------
select tests.login('admin'); set role authenticated;
update profiles set status = 'disabled' where email = 'judge3@example.com';
reset role;
select tests.login('j3'); set role authenticated;
select tests.ok((select count(*) from teams) = 0, 'disabled judge sees no teams');
select tests.throws($$select start_evaluation((select id from public.teams where team_code='T6'))$$, 'not an approved judge|null value', 'disabled judge cannot evaluate');
reset role;

-- -----------------------------------------------------------------------------
-- 10. Hard constraints
-- -----------------------------------------------------------------------------
select tests.throws($$insert into evaluations (team_id, judge_id, template_id) select team_id, judge_id, template_id from evaluations limit 1$$, 'evaluations_team_judge_key', 'unique (team, judge) enforced');
select tests.throws($$update evaluations set status = 'submitted', submitted_at = now(), core_scored_count = 3 where id = (select v from ids where k='e2') $$, 'submitted_complete', 'check constraint forbids incomplete submitted rows');

select 'DONE' as result;
