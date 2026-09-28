-- =============================================================================
-- Add DEMI Grade 6 without changing any existing rubric, team, evaluation or result
-- Source: DEMI_Grade_6_Judges_Rubric_Revised.pdf
-- =============================================================================

insert into public.rubric_templates
  (id, title, subtitle, source_pdf, scale_instruction, guidance, core_max, bonus_max)
values (
  'DEMI_G6',
  'Stage 3 Judges'' Rubric - DEMI Grade 6',
  'Robotics + AI Project - Stage 3 Judge Evaluation',
  'DEMI_Grade_6_Judges_Rubric_Revised.pdf',
  'Enter ONE number from 1 to 5. Every row is worth 5 points; harder sections have more rows and therefore more weight.',
  'Judge the final Stage 3 work, using the previous-phase requirements as the baseline. Reward evidence, correct integration, and purposeful design - not complexity for its own sake. Testing: look for real trials/results, not only claims. Hardware: reward the best-fit use of components and reliable integration. Teamwork & presentation: look for shared ownership, clear communication, and the ability of multiple members to answer questions.',
  100,
  15
);

insert into public.rubric_sections (id, template_id, position, title, weight, is_bonus) values
  ('DEMI_G6.S1', 'DEMI_G6', 1, 'Problem, Research & Solution', 15, false),
  ('DEMI_G6.S2', 'DEMI_G6', 2, 'Hardware, System & Robotics', 30, false),
  ('DEMI_G6.S3', 'DEMI_G6', 3, 'Programming & AI', 20, false),
  ('DEMI_G6.S4', 'DEMI_G6', 4, 'Prototype & Testing', 15, false),
  ('DEMI_G6.S5', 'DEMI_G6', 5, 'Business & Value', 5, false),
  ('DEMI_G6.S6', 'DEMI_G6', 6, 'Teamwork & Presentation', 15, false),
  ('DEMI_G6.BONUS', 'DEMI_G6', 7, 'Extra Requirements / Optional Bonus', 15, true);

insert into public.rubric_criteria
  (id, section_id, template_id, is_bonus, position, title, description, max_points)
values
  ('DEMI_G6.S1.C1', 'DEMI_G6.S1', 'DEMI_G6', false, 1, 'Problem, user & research', 'Problem and target user are specific, important, and supported by relevant research or comparison with existing ideas.', 5),
  ('DEMI_G6.S1.C2', 'DEMI_G6.S1', 'DEMI_G6', false, 2, 'Solution fit', 'Main functions clearly solve the identified problem and remain consistent with the same user and use case.', 5),
  ('DEMI_G6.S1.C3', 'DEMI_G6.S1', 'DEMI_G6', false, 3, 'Value & overall concept coherence', 'Hardware, programming, AI, robotics, and user value form one coherent solution rather than separate features.', 5),

  ('DEMI_G6.S2.C1', 'DEMI_G6.S2', 'DEMI_G6', false, 1, 'Purposeful hardware selection', 'Kit, sensors, servos/actuators, and other parts are chosen because they best support the solution.', 5),
  ('DEMI_G6.S2.C2', 'DEMI_G6.S2', 'DEMI_G6', false, 2, 'Input/output roles', 'Sensor inputs and actuator/servo outputs are technically correct and clearly explained.', 5),
  ('DEMI_G6.S2.C3', 'DEMI_G6.S2', 'DEMI_G6', false, 3, 'Circuit & system design', 'Circuit and block/system design are correct, organized, and match the implemented prototype.', 5),
  ('DEMI_G6.S2.C4', 'DEMI_G6.S2', 'DEMI_G6', false, 4, 'Robot movement sequence', 'Robot movement/behavior is logical, coordinated, and matches the planned sequence or task.', 5),
  ('DEMI_G6.S2.C5', 'DEMI_G6.S2', 'DEMI_G6', false, 5, 'Hardware integration & control', 'Arduino/controller reliably connects sensing, decisions, and physical movement as one system.', 5),
  ('DEMI_G6.S2.C6', 'DEMI_G6.S2', 'DEMI_G6', false, 6, 'Best hardware use & reliability', 'Team uses available hardware capabilities effectively and demonstrates consistent, safe, repeatable operation.', 5),

  ('DEMI_G6.S3.C1', 'DEMI_G6.S3', 'DEMI_G6', false, 1, 'Core programming logic', 'Events, variables, conditions, loops, and outputs correctly control the system.', 5),
  ('DEMI_G6.S3.C2', 'DEMI_G6.S3', 'DEMI_G6', false, 2, 'Functions / lists / stronger logic', 'Uses functions, lists, or other suitable concepts to organize and strengthen the program.', 5),
  ('DEMI_G6.S3.C3', 'DEMI_G6.S3', 'DEMI_G6', false, 3, 'AI/ML approach & relevance', 'AI/ML type (classification, regression, clustering, etc.) is appropriate and meaningfully supports the solution.', 5),
  ('DEMI_G6.S3.C4', 'DEMI_G6.S3', 'DEMI_G6', false, 4, 'AI evidence & system connection', 'Shows evidence of the AI concept/model and explains how its decision connects to the robot/system behavior.', 5),

  ('DEMI_G6.S4.C1', 'DEMI_G6.S4', 'DEMI_G6', false, 1, 'End-to-end prototype', 'Core sensing, decision, programming, and robot behavior work together in the final demonstration.', 5),
  ('DEMI_G6.S4.C2', 'DEMI_G6.S4', 'DEMI_G6', false, 2, 'Evidence of testing', 'Team provides repeated trials, measurements, logs, videos/screenshots, or success counts that prove testing occurred.', 5),
  ('DEMI_G6.S4.C3', 'DEMI_G6.S4', 'DEMI_G6', false, 3, 'Improvement from results', 'Testing leads to meaningful changes in thresholds, movement, timing, model behavior, or reliability.', 5),

  ('DEMI_G6.S5.C1', 'DEMI_G6.S5', 'DEMI_G6', false, 1, 'Target customer & value', 'Business idea identifies the user/customer and explains the practical value of the solution.', 5),

  ('DEMI_G6.S6.C1', 'DEMI_G6.S6', 'DEMI_G6', false, 1, 'Shared ownership & teamwork', 'Members have clear roles, contribute meaningfully, and support one another during build/demo.', 5),
  ('DEMI_G6.S6.C2', 'DEMI_G6.S6', 'DEMI_G6', false, 2, 'Communication & technical explanation', 'Team explains the robot, hardware, code, AI, and testing clearly and accurately.', 5),
  ('DEMI_G6.S6.C3', 'DEMI_G6.S6', 'DEMI_G6', false, 3, 'Presentation, demo & Q&A', 'Presentation is structured, confident, and within time; questions are answered with evidence and understanding.', 5),

  ('DEMI_G6.BONUS.C1', 'DEMI_G6.BONUS', 'DEMI_G6', true, 1, 'Advanced programming feature', 'Optional advanced code feature meaningfully improves the existing system and is supported by code/logic evidence.', 5),
  ('DEMI_G6.BONUS.C2', 'DEMI_G6.BONUS', 'DEMI_G6', true, 2, 'Advanced AI/ML feature', 'Optional AI/ML feature goes deeper than the core AI requirement and is supported by evidence or a credible prototype.', 5),
  ('DEMI_G6.BONUS.C3', 'DEMI_G6.BONUS', 'DEMI_G6', true, 3, 'Godot application', 'Optional Godot feature meaningfully explains, simulates, or supports the same project concept and includes design/code evidence.', 5);

insert into public.competitions (code, organization, label, template_id, sort_order)
values ('DEMI_G6', 'DEMI', 'Grade 6', 'DEMI_G6', 3);

insert into public.levels (code, organization, label, competition_code, sort_order)
values ('G6', 'DEMI', 'Grade 6', 'DEMI_G6', 3);

insert into public.results_signal (competition_code) values ('DEMI_G6');

-- Abort atomically if the PDF structure was seeded incorrectly.
do $$
declare
  v_weights text;
  v_core int;
  v_bonus int;
  v_core_rows int;
  v_bonus_rows int;
begin
  select string_agg(weight::text, ',' order by position),
         sum(weight) filter (where not is_bonus),
         sum(weight) filter (where is_bonus)
    into v_weights, v_core, v_bonus
  from public.rubric_sections
  where template_id = 'DEMI_G6';

  select count(*) filter (where not is_bonus), count(*) filter (where is_bonus)
    into v_core_rows, v_bonus_rows
  from public.rubric_criteria
  where template_id = 'DEMI_G6';

  if v_weights <> '15,30,20,15,5,15,15'
     or v_core <> 100 or v_bonus <> 15
     or v_core_rows <> 20 or v_bonus_rows <> 3 then
    raise exception 'DEMI Grade 6 rubric integrity check failed';
  end if;

  if exists (
    select 1 from public.rubric_sections s
    where s.template_id = 'DEMI_G6'
      and s.weight <> (select count(*) * 5 from public.rubric_criteria c where c.section_id = s.id)
  ) then
    raise exception 'DEMI Grade 6 section weight does not equal criteria x 5';
  end if;
end;
$$;
