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
    when 'ji'    then '00000000-0000-0000-0000-00000000000e'
    when 'jt'    then '00000000-0000-0000-0000-00000000000d'
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

create function tests.rubric_payload(p_template text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'title', t.title, 'subtitle', t.subtitle, 'scale_instruction', t.scale_instruction, 'guidance', t.guidance,
    'score_levels', (select jsonb_agg(jsonb_build_object('value',value,'label',label,'description',description) order by value) from rubric_score_levels where template_id=t.id),
    'sections', (select jsonb_agg(jsonb_build_object('title',s.title,'weight',s.weight,'is_bonus',s.is_bonus,
      'criteria',(select jsonb_agg(jsonb_build_object('title',c.title,'description',c.description) order by c.position) from rubric_criteria c where c.section_id=s.id)) order by s.position)
      from rubric_sections s where s.template_id=t.id)
  ) from rubric_templates t where t.id=p_template $$;
grant execute on function tests.rubric_payload(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 0. Rubric integrity in the database
-- -----------------------------------------------------------------------------
select tests.ok((select count(*) from rubric_templates) = 7, 'seven rubric templates');
select tests.ok((select bool_and(core_max = 100) from rubric_templates), 'every rubric core total is 100');
select tests.ok((select count(*) from rubric_criteria where not is_bonus) = 140, '7 x 20 core criteria');
select tests.ok((select bonus_max from rubric_templates where id = 'DECI_L45') = 15, 'L4&5 bonus max 15 as in PDF');
select tests.ok((select bonus_max from rubric_templates where id = 'DEMI_G6') = 15, 'Grade 6 bonus max 15 as in PDF');
select tests.ok((select count(*) from rubric_templates where id not in ('DECI_L45', 'DEMI_G6') and bonus_max = 10) = 5, 'other bonus max 10');
select tests.ok(not exists (
  select 1 from rubric_sections s where weight <> (select count(*)*5 from rubric_criteria c where c.section_id = s.id)
), 'every section weight = rows x 5');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DEMI_G4' and not is_bonus) = '20,15,25,15,10,15', 'G4 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DEMI_G5' and not is_bonus) = '15,25,20,15,10,15', 'G5 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DEMI_G6' and not is_bonus) = '15,30,20,15,5,15', 'G6 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DECI_L1' and not is_bonus) = '15,20,20,15,10,5,15', 'L1 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DECI_L2' and not is_bonus) = '15,25,15,15,10,5,15', 'L2 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DECI_L3' and not is_bonus) = '15,25,20,10,10,5,15', 'L3 weights');
select tests.ok((select string_agg(weight::text, ',' order by position) from rubric_sections where template_id='DECI_L45' and not is_bonus) = '10,25,20,15,15,15', 'L4&5 weights');
select tests.ok((select count(*) from governorates) = 5, 'five governorates');
select tests.ok((select competition_code from levels where code = 'G6') = 'DEMI_G6', 'Grade 6 has a separate DEMI competition and leaderboard');
select tests.ok((select count(*) from levels where organization='DECI' and is_active and competition_code='DECI_L45' and code='L45' and label='Levels 4 & 5') = 1, 'one active combined Levels 4 & 5 option');
select tests.ok((select count(*) from levels where code in ('L4','L5') and not is_active) = 2, 'legacy L4 and L5 reference rows are retained but hidden');
select tests.ok((select count(*) from rubric_templates where family_id='DECI_L45') = 1, 'combined category does not duplicate its rubric');

-- -----------------------------------------------------------------------------
-- 1. Sign-up creates pending judges; bootstrap admin
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, invited_at) values
  (tests.uid('admin'), 'admin@example.com', '{"full_name":"Ada Admin"}', now()),
  (tests.uid('j1'), 'judge1@example.com', '{"full_name":"Judge One"}', now()),
  (tests.uid('j2'), 'judge2@example.com', '{"full_name":"Judge Two"}', now()),
  (tests.uid('j3'), 'judge3@example.com', '{"full_name":"Judge Three"}', now()),
  (tests.uid('jp'), 'pending@example.com', '{"full_name":"Pending Person"}', now());

select tests.ok((select count(*) from profiles where role = 'judge' and status = 'pending') = 5, 'invited users start as pending judges');
select tests.throws($$insert into auth.users(id,email) values(gen_random_uuid(),'public-signup@example.com')$$, 'Public registration is disabled', 'database trigger blocks public signup');
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
  ('T3', 'Team Three', 'Crop Watch', 'L45', 'AST'),
  ('T4', 'Team Four', 'Safe Home', 'L45', 'SUZ'),
  ('T5', 'Team Five', 'Robo Arm', 'L1', 'MNF'),
  ('T6', 'Team Six', 'Health Band', 'G5', 'CAI');
insert into teams (team_code, name, project_name, level_code, governorate_code) values
  ('ORG-DUP', 'DEMI duplicate scope', 'One', 'G4', 'CAI'),
  ('org-dup', 'DECI duplicate scope', 'Two', 'L1', 'CAI');
select tests.ok((select count(*) from teams where lower(team_code)='org-dup')=2, 'same Team ID is allowed once in DEMI and once in DECI');
select tests.throws($$insert into teams (team_code, name, project_name, level_code, governorate_code) values ('Org-Dup','same org','Three','G5','CAI')$$, 'duplicate key', 'same Team ID is rejected across grades in one organization');
delete from teams where lower(team_code)='org-dup';
select tests.throws($$insert into team_judges (team_id, judge_id) select id, tests.uid('jp') from teams where team_code='T1'$$, 'Only approved', 'pending account cannot be assigned');

select admin_set_team_judges((select id from teams where team_code='T1'), array[tests.uid('j1'), tests.uid('j2')]);
select admin_set_team_judges((select id from teams where team_code='T2'), array[tests.uid('j1')]);
select admin_set_team_judges((select id from teams where team_code='T3'), array[tests.uid('j1'), tests.uid('j2')]);
select admin_set_team_judges((select id from teams where team_code='T4'), array[tests.uid('j2')]);
select admin_set_team_judges((select id from teams where team_code='T5'), array[tests.uid('j3')]);
select admin_set_team_judges((select id from teams where team_code='T6'), array[tests.uid('j3')]);
select tests.ok((select count(*) from team_judges) = 8, 'assignments created (multiple judges per team)');
reset role;

-- Administrator invitation: a one-use server authorization is required at the
-- INSERT trigger, then preassigned teams stay hidden until acceptance.
select tests.login('admin'); set role authenticated;
select admin_begin_account_provisioning('invited@example.com','invitation')::text as invitation_provisioning_token \gset
reset role;
insert into auth.users(id,email,raw_user_meta_data)
values(tests.uid('ji'),'invited@example.com',jsonb_build_object('full_name','Invited Judge','provisioning_token',:'invitation_provisioning_token'));
select tests.login('admin'); set role authenticated;
select admin_record_invitation(null,tests.uid('ji'),'invited@example.com','Invited Judge',now()+interval '1 hour',array[(select id from teams where team_code='T6')]);
select tests.ok((select status='pending' from user_invitations where auth_user_id=tests.uid('ji')), 'administrator records pending invitation');
select tests.ok((select count(*)=1 from team_judges where judge_id=tests.uid('ji')), 'invited pending judge can be preassigned');
reset role;
select tests.login('ji'); set role authenticated;
select tests.ok((select count(*) from teams)=0, 'invited judge sees no teams before acceptance');
select tests.throws($$select accept_my_invitation()$$,'Set a password','invitation cannot activate before password is set');
reset role;
update auth.users set encrypted_password='test-hash' where id=tests.uid('ji');
select tests.login('ji'); set role authenticated;
select accept_my_invitation();
select tests.ok((select status='approved' from profiles where id=tests.uid('ji')), 'accepting invitation activates judge');
select tests.ok((select count(*) from teams)=1, 'accepted judge sees only assigned team');
select tests.throws($$select admin_set_judge_teams(tests.uid('ji'),'{}'::uuid[])$$,'Administrator access required','judge cannot manage assignments');
reset role;
select tests.login('admin'); set role authenticated;
select admin_set_judge_teams(tests.uid('ji'),'{}'::uuid[]);
reset role;
delete from auth.users where id=tests.uid('ji');

-- Temporary-password account: server provisioning is accepted, but all judge
-- data remains blocked until the service-only completion RPC clears the gate.
select tests.login('admin'); set role authenticated;
select admin_begin_account_provisioning('temporary@example.com','temporary_password')::text as temporary_provisioning_token \gset
reset role;
insert into auth.users(id,email,raw_user_meta_data,encrypted_password)
values(tests.uid('jt'),'temporary@example.com',jsonb_build_object('full_name','Temporary Judge','provisioning_token',:'temporary_provisioning_token'),'temporary-hash');
select tests.login('admin'); set role authenticated;
select admin_record_temporary_user(tests.uid('jt'),'temporary@example.com','Temporary Judge',array[(select id from teams where team_code='T6')]);
select tests.ok((select password_change_required from profiles where id=tests.uid('jt')), 'temporary account requires password change');
reset role;
select tests.login('jt'); set role authenticated;
select tests.ok((select count(*) from teams)=0, 'temporary-password judge cannot read assigned teams before changing password');
select tests.throws($$select service_complete_password_change(auth.uid())$$,'permission denied','judge cannot bypass password change gate through RPC');
reset role;
select service_complete_password_change(tests.uid('jt'));
select tests.login('jt'); set role authenticated;
select tests.ok((select count(*) from teams)=1, 'judge sees assigned team after mandatory password change completion');
reset role;
delete from auth.users where id=tests.uid('jt');

-- -----------------------------------------------------------------------------
-- 2. Judges see only assigned teams; pending users see nothing
-- -----------------------------------------------------------------------------
select tests.login('jp'); set role authenticated;
select tests.ok((select count(*) from teams) = 0, 'pending user sees no teams');
select tests.throws($$select * from get_leaderboard()$$, 'approved active account', 'pending user cannot read leaderboards');
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
select tests.throws($$select * from get_leaderboard()$$, 'Administrator access required', 'judge cannot call leaderboard RPC');
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
select tests.ok((select string_agg(team_code || ':' || level_code || ':' || rank, ',' order by rank) from get_leaderboard(p_competition := 'DECI_L45')) = 'T4:L45:1,T3:L45:2', 'Levels 4 & 5 share one combined category and level code');
select tests.ok((select string_agg(team_code, ',' order by team_code) from get_leaderboard(p_level := 'L45')) = 'T3,T4', 'combined level filter includes all Levels 4 & 5 teams');
select tests.ok(not exists (select 1 from get_leaderboard(p_organization := 'DEMI') where organization <> 'DEMI'), 'DEMI filter returns only DEMI');
select tests.ok(not exists (select 1 from get_leaderboard(p_organization := 'DECI') where organization <> 'DECI'), 'DECI filter returns only DECI');
select tests.ok((select count(distinct competition_code) from get_leaderboard() where is_top) = 2, 'a top team is flagged per competition (DEMI_G4, DECI_L45)');
select tests.ok((select string_agg(team_code, ',') from get_leaderboard(p_governorate := 'CAI')) = 'T1', 'governorate filter');
select tests.ok(not exists (select 1 from get_leaderboard() where team_code in ('T5','T6')), 'teams without submissions not listed');
select tests.ok((select (s->>'completed_evaluations')::int = 6 and (s->>'pending_evaluations')::int = 2 and (s->>'total_teams')::int = 6 and (s->>'total_judges')::int = 3 from admin_dashboard_stats() s), 'dashboard counts');
select tests.ok((select not ((s->'by_level') @> '[{"code":"L4"}]'::jsonb) and not ((s->'by_level') @> '[{"code":"L5"}]'::jsonb) and ((s->'by_level') @> '[{"code":"L45","label":"Levels 4 & 5"}]'::jsonb) from admin_dashboard_stats() s), 'dashboard exposes only the combined Levels 4 & 5 category');
reset role;

-- -----------------------------------------------------------------------------
-- 6. Private publication control (anonymous callers see no platform data;
-- approved judges see only published boards)
-- -----------------------------------------------------------------------------
select tests.logout(); set role anon;
select tests.throws($$select * from get_leaderboard()$$, 'permission denied', 'anon cannot call leaderboard RPC');
select tests.throws($$select * from get_competitions()$$, 'permission denied', 'anon cannot call competition RPC');
select tests.throws($$select * from governorates$$, 'permission denied', 'anon cannot read reference data');
select tests.throws($$select * from results_signal$$, 'permission denied', 'anon cannot subscribe to result signals');
select tests.throws($$select * from teams$$, 'permission denied', 'anon cannot read teams');
select tests.throws($$select * from evaluations$$, 'permission denied', 'anon cannot read evaluations');
select tests.throws($$select * from rubric_criteria$$, 'permission denied', 'anon cannot read rubric tables');
select tests.throws($$select * from public._team_results()$$, 'permission denied', 'internal results function not callable');
select tests.throws($$select admin_set_publication('DEMI_G4', true)$$, 'permission denied|Administrator', 'anon cannot publish');
reset role;

select tests.login('j3'); set role authenticated;
select tests.throws($$select * from get_leaderboard()$$, 'Administrator access required', 'approved judge cannot read unpublished boards');
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
select tests.throws($$select * from get_leaderboard()$$, 'permission denied', 'anon cannot see a published board');
reset role;
select tests.login('j3'); set role authenticated;
select tests.throws($$select * from get_leaderboard()$$, 'Administrator access required', 'approved judge cannot read a published board');
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

-- rubric change blocked once evaluated; the combined category stays pinned
select tests.throws($$update teams set level_code = 'G5' where team_code = 'T1'$$, 'cannot move to a different rubric', 'cannot move evaluated team to another rubric');
select tests.throws($$update teams set level_code = 'L4' where team_code = 'T3'$$, 'not available', 'inactive legacy L4 cannot be selected');
select tests.ok((select level_code from get_leaderboard() where team_code='T3') = 'L45', 'evaluated team remains in combined category');
select tests.throws($$delete from teams where team_code = 'T1'$$, 'foreign key|violates', 'evaluated team cannot be deleted accidentally');

-- -----------------------------------------------------------------------------
-- 8. Bulk import: atomic validation
-- -----------------------------------------------------------------------------
select tests.ok((select (r->>'ok')::boolean = false and jsonb_array_length(r->'errors') >= 3 from admin_import_teams('[
  {"team_code":"N1","name":"New One","project_name":"P1","level_code":"G4","governorate":"Cairo","judge_emails":["judge1@example.com"]},
  {"team_code":"N2","name":"","project_name":"P2","level_code":"G9","governorate":"Giza","judge_emails":["nobody@example.com"]}
]'::jsonb) r), 'invalid import reports row errors');
select tests.ok(not exists (select 1 from teams where team_code = 'N1'), 'invalid import writes nothing (atomic)');
select tests.ok((select (r->>'ok')::boolean and (r->>'inserted')::int = 3 and (r->>'updated')::int = 1 and (r->>'assignments_added')::int = 5 from admin_import_teams('[
  {"team_code":"N1","name":"New One","project_name":"P1","level_code":"G4","governorate":"cairo","judge_emails":["JUDGE1@example.com","judge2@example.com"]},
  {"team_code":"N2","name":"New Two","project_name":"P2","level_code":"L45","governorate":"SUZ","judge_emails":["judge3@example.com"]},
  {"team_code":"N3","name":"Grade Six Team","project_name":"Rescue Robot","level_code":"G6","governorate":"CAI","judge_emails":["judge1@example.com","judge2@example.com"]},
  {"team_code":"T5","name":"Team Five","project_name":"Robo Arm v2","level_code":"L1","governorate":"MNF","judge_emails":[]}
]'::jsonb) r), 'valid import inserts/updates teams and assigns judges');
select tests.ok((select project_name from teams where team_code='T5') = 'Robo Arm v2', 'import upserts by team ID');
select tests.ok((select (r->>'ok')::boolean = false from admin_import_teams('[
  {"team_code":"D1","name":"a","project_name":"b","level_code":"G4","governorate":"CAI"},
  {"team_code":"d1","name":"a","project_name":"b","level_code":"G5","governorate":"CAI"}]'::jsonb) r), 'duplicate IDs across grades in the same organization are rejected');
select tests.ok((select (r->>'ok')::boolean and (r->>'inserted')::int=2 from admin_import_teams('[
  {"team_code":"XORG","name":"DEMI XORG","project_name":"Separate DEMI","level_code":"G4","governorate":"CAI","judge_emails":["judge1@example.com"]},
  {"team_code":"xorg","name":"DECI XORG","project_name":"Separate DECI","level_code":"L1","governorate":"ALX","judge_emails":["judge2@example.com"]}]'::jsonb) r), 'import allows the same Team ID in DEMI and DECI');
select tests.ok((select count(distinct id)=2 and count(distinct organization)=2 from teams where lower(team_code)='xorg'), 'cross-organization imports have distinct internal team IDs');
reset role;

select tests.login('j1'); set role authenticated;
insert into ids values ('xorg-demi', start_evaluation((select id from teams where lower(team_code)='xorg' and organization='DEMI')));
select submit_evaluation((select v from ids where k='xorg-demi'), tests.payload('DEMI_G4', tests.arr(20,5,0), array[5,5]));
reset role;

select tests.login('j2'); set role authenticated;
insert into ids values ('xorg-deci', start_evaluation((select id from teams where lower(team_code)='xorg' and organization='DECI')));
select submit_evaluation((select v from ids where k='xorg-deci'), tests.payload('DECI_L1', tests.arr(10,3,10), array[1,1]));
reset role;

select tests.login('admin'); set role authenticated;
select tests.ok((select count(distinct team_id)=2 from evaluations where id in ((select v from ids where k='xorg-demi'),(select v from ids where k='xorg-deci'))), 'overlapping Team IDs keep evaluations attached to separate team UUIDs');
select tests.ok((select count(*)=2 and min(avg_core)=80 and max(avg_core)=100 from admin_team_results() where lower(team_code)='xorg'), 'overlapping Team IDs keep independent result calculations');
reset role;

-- -----------------------------------------------------------------------------
-- 9. Grade 6 judging, permissions, averaging and separate leaderboard
-- -----------------------------------------------------------------------------
select tests.login('j1'); set role authenticated;
insert into ids values ('e7', start_evaluation((select id from teams where team_code='N3')));
select tests.ok((select count(*) from evaluation_scores where evaluation_id = (select v from ids where k='e7')) = 23, 'G6 evaluation has 20 core + 3 bonus rows');
select submit_evaluation((select v from ids where k='e7'), tests.payload('DEMI_G6', tests.arr(15, 2, 5), array[5,5,5]));
reset role;

select tests.login('j2'); set role authenticated;
select tests.ok((select count(*) from evaluations where team_id = (select id from teams where team_code='N3')) = 0, 'G6 judge cannot see the other judge evaluation');
insert into ids values ('e8', start_evaluation((select id from teams where team_code='N3')));
select submit_evaluation((select v from ids where k='e8'), tests.payload('DEMI_G6', tests.arr(15, 4, 5), array[5,null,null]));
select tests.ok((select count(*) from evaluations where team_id = (select id from teams where team_code='N3')) = 1, 'G6 judge sees only their independent evaluation');
reset role;

select tests.login('admin'); set role authenticated;
select tests.ok((select is_complete and avg_core = 90 and avg_bonus = 10 from admin_team_results() where team_code='N3'), 'G6 result averages two judges and keeps bonus separate');
select tests.ok((select count(*) = 1 and min(team_code) = 'N3' from get_leaderboard(p_competition := 'DEMI_G6')), 'G6 has a separate leaderboard');
select tests.ok((select count(*) = 1 from get_leaderboard(p_competition := 'DEMI_G6', p_governorate := 'CAI')), 'G6 leaderboard supports governorate filtering');
select tests.ok((select count(*) = 0 from get_leaderboard(p_competition := 'DEMI_G6', p_governorate := 'ALX')), 'G6 governorate filter excludes other governorates');
reset role;

-- -----------------------------------------------------------------------------
-- 10. Rubric draft/version management
-- -----------------------------------------------------------------------------
select tests.login('j1'); set role authenticated;
select tests.ok((select count(*) from rubric_templates) = 7, 'judge can read all seven active competition rubrics');
select tests.ok(exists (select 1 from rubric_templates where id='DECI_L45'), 'judge can read the rubric pinned to an assigned team');
select tests.ok(exists (select 1 from rubric_templates where id='DECI_L1'), 'judge can read an unassigned active rubric');
select tests.throws($$select admin_create_rubric_draft('DEMI_G4')$$, 'Administrator access required', 'judge cannot create rubric drafts');
select tests.throws($$update rubric_templates set title='tampered' where id='DEMI_G4'$$, 'permission denied|row-level security', 'judge cannot edit rubric tables');
reset role;

select tests.login('admin'); set role authenticated;
create temp table rubric_ids (k text primary key, v text); grant all on rubric_ids to authenticated;
insert into rubric_ids values ('draft', admin_create_rubric_draft('DEMI_G4'));
select tests.ok((select lifecycle='draft' and version=2 and based_on_id='DEMI_G4' from rubric_templates where id=(select v from rubric_ids where k='draft')), 'published rubric cloned to version 2 draft');
select tests.ok((select count(*) from rubric_criteria where template_id=(select v from rubric_ids where k='draft'))=22, 'draft clone contains every core and bonus criterion');
select tests.throws($$update rubric_templates set title='overwrite' where id='DEMI_G4'$$, 'permission denied', 'published rubric cannot be overwritten directly');

reset role;
select tests.login('j1'); set role authenticated;
select tests.ok(not exists (select 1 from rubric_templates where id=(select v from rubric_ids where k='draft')), 'judge cannot read an unpublished rubric draft');
reset role;
select tests.login('admin'); set role authenticated;

select admin_save_rubric_draft((select v from rubric_ids where k='draft'),
  jsonb_set(tests.rubric_payload((select v from rubric_ids where k='draft')), '{title}', '"Grade 4 revised"'));
select tests.ok((select title from rubric_templates where id='DEMI_G4') <> 'Grade 4 revised', 'saving draft leaves published version unchanged');
select tests.ok((select title from rubric_templates where id=(select v from rubric_ids where k='draft')) = 'Grade 4 revised', 'draft title saved');

select admin_save_rubric_draft((select v from rubric_ids where k='draft'),
  jsonb_set(tests.rubric_payload((select v from rubric_ids where k='draft')), '{sections,0,weight}', '15'));
select tests.throws(format('select admin_publish_rubric(%L,%L)',(select v from rubric_ids where k='draft'),'keep_existing'), 'Core section weights|Invalid section weights', 'invalid draft cannot be published');
select admin_save_rubric_draft((select v from rubric_ids where k='draft'),
  jsonb_set(jsonb_set(jsonb_set(tests.rubric_payload('DEMI_G4'),'{title}','"Grade 4 revised"'),'{sections,0,criteria,0,description}','"Revised criterion description"'),'{score_levels,0,label}','"Needs Work"'));
insert into teams(team_code,name,project_name,level_code,governorate_code) values('VR1','Version Ready','P','G4','CAI');
select admin_publish_rubric((select v from rubric_ids where k='draft'),'move_unevaluated');
select tests.ok((select template_id from competitions where code='DEMI_G4')=(select v from rubric_ids where k='draft'), 'publishing activates the new version');
select tests.ok((select template_id from teams where team_code='VR1')=(select v from rubric_ids where k='draft'), 'explicit option moves unevaluated teams');
select tests.ok((select template_id from teams where team_code='T1')='DEMI_G4', 'team with evaluations remains pinned to historical version');
select tests.ok((select avg_core=89.5 from admin_team_results() where team_code='T1'), 'historical team result is preserved after rubric publication');
select tests.ok((select label from rubric_score_levels where template_id=(select v from rubric_ids where k='draft') and value=1)='Needs Work', 'versioned scoring configuration published');
reset role;

-- Exercise the same persisted clone/save/reload/publish path for the three
-- representative families requested by the rubric-management regression.
create function tests.exercise_rubric_version(p_source text, p_marker text) returns void language plpgsql as $$
declare
  v_draft text;
  v_payload jsonb;
  v_bonus_index int;
  v_old_description text;
  v_old_evaluations int;
  v_old_results jsonb;
  v_competition text;
begin
  select c.description into v_old_description
    from rubric_criteria c join rubric_sections s on s.id=c.section_id
   where c.template_id=p_source and not c.is_bonus
   order by s.position,c.position limit 1;
  select count(*) into v_old_evaluations from evaluations where template_id=p_source;
  select c.code into v_competition from competitions c join rubric_templates t on t.family_id=c.rubric_family_id where t.id=p_source;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.team_id),'[]'::jsonb) into v_old_results
    from admin_team_results() r where r.competition_code=v_competition;

  v_draft := admin_create_rubric_draft(p_source);
  perform tests.ok((select lifecycle='draft' and based_on_id=p_source from rubric_templates where id=v_draft), p_marker||' creates a separate draft');

  v_payload := jsonb_set(tests.rubric_payload(v_draft),'{sections,0,criteria,0,description}',to_jsonb(p_marker||' revised description'));
  select ordinality-1 into v_bonus_index
    from jsonb_array_elements(v_payload->'sections') with ordinality x(section,ordinality)
   where (section->>'is_bonus')::boolean;
  v_payload := jsonb_set(v_payload,array['sections',v_bonus_index::text,'criteria'],
    (v_payload #> array['sections',v_bonus_index::text,'criteria']) ||
      jsonb_build_array(jsonb_build_object('title',p_marker||' added bonus criterion','description','Persisted bonus requirement')));
  v_payload := jsonb_set(v_payload,array['sections',v_bonus_index::text,'weight'],
    to_jsonb(((v_payload #>> array['sections',v_bonus_index::text,'weight'])::int)+5));

  perform admin_save_rubric_draft(v_draft,v_payload);
  -- Fresh SQL reads model a browser refresh and must recover both edits.
  perform tests.ok((select c.description=p_marker||' revised description' from rubric_criteria c join rubric_sections s on s.id=c.section_id where c.template_id=v_draft and not c.is_bonus order by s.position,c.position limit 1), p_marker||' criterion edit survives reload');
  perform tests.ok((select count(*)=1 from rubric_criteria where template_id=v_draft and title=p_marker||' added bonus criterion'), p_marker||' added criterion survives reload');

  perform admin_publish_rubric(v_draft,'keep_existing');
  perform tests.ok((select lifecycle='published' from rubric_templates where id=v_draft), p_marker||' draft publishes');
  perform tests.ok((select template_id=v_draft from competitions where code=v_competition), p_marker||' published version becomes active');
  perform tests.ok((select count(*)=1 from rubric_criteria where template_id=v_draft and title=p_marker||' added bonus criterion'), p_marker||' published version contains the addition');
  perform tests.ok((select description=v_old_description from rubric_criteria c join rubric_sections s on s.id=c.section_id where c.template_id=p_source and not c.is_bonus order by s.position,c.position limit 1), p_marker||' historical rubric is unchanged');
  perform tests.ok((select count(*) from evaluations where template_id=p_source)=v_old_evaluations, p_marker||' historical evaluations are unchanged');
  perform tests.ok((select coalesce(jsonb_agg(to_jsonb(r) order by r.team_id),'[]'::jsonb) from admin_team_results() r where r.competition_code=v_competition)=v_old_results, p_marker||' team results are unchanged');
end $$;
grant execute on function tests.exercise_rubric_version(text,text) to authenticated;

select tests.login('admin'); set role authenticated;
select tests.exercise_rubric_version('DEMI_G5','DEMI Grade 5');
select tests.exercise_rubric_version('DEMI_G6','DEMI Grade 6');
select tests.exercise_rubric_version('DECI_L1','DECI Level 1');
reset role;

-- -----------------------------------------------------------------------------
-- 11. Disabled judges lose access immediately
-- -----------------------------------------------------------------------------
select tests.login('admin'); set role authenticated;
update profiles set status = 'disabled' where email = 'judge3@example.com';
reset role;
select tests.login('j3'); set role authenticated;
select tests.ok((select count(*) from teams) = 0, 'disabled judge sees no teams');
select tests.throws($$select * from get_leaderboard()$$, 'Administrator access required', 'disabled judge cannot read leaderboards');
select tests.throws($$select start_evaluation((select id from public.teams where team_code='T6'))$$, 'not an approved judge|null value', 'disabled judge cannot evaluate');
reset role;

-- -----------------------------------------------------------------------------
-- 12. Hard constraints
-- -----------------------------------------------------------------------------
select tests.throws($$insert into evaluations (team_id, judge_id, template_id) select team_id, judge_id, template_id from evaluations limit 1$$, 'evaluations_team_judge_key', 'unique (team, judge) enforced');
select tests.throws($$update evaluations set status = 'submitted', submitted_at = now(), core_scored_count = 3 where id = (select v from ids where k='e2') $$, 'submitted_complete', 'check constraint forbids incomplete submitted rows');

select 'DONE' as result;
