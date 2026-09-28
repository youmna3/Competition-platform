-- =============================================================================
-- DEMI / DECI Judges Evaluation Platform — core schema
-- =============================================================================
-- Tables
--   profiles            one row per auth user (role + approval status)
--   governorates        the five competition governorates
--   rubric_templates    one row per PDF rubric (6)
--   rubric_sections     sections of each rubric (core + the optional bonus)
--   rubric_criteria     rows ("specific judging tasks"), each scored 1-5
--   score_levels        the shared 1-5 scale descriptions
--   competitions        leaderboard categories (DEMI G4, G5; DECI L1, L2, L3, L4&5)
--   levels              actual grade/level of a team (G4, G5, L1, L2, L3, L4, L5)
--   teams               registered teams
--   team_judges         judge assignments (many judges per team)
--   evaluations         one evaluation per (team, judge) — never duplicated
--   evaluation_scores   one row per (evaluation, criterion)
--   audit_log           every score / status / assignment change
--   results_signal      bumped whenever results may change (realtime refresh)
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role          as enum ('admin', 'judge');
create type public.account_status    as enum ('pending', 'approved', 'rejected', 'disabled');
create type public.organization_code as enum ('DEMI', 'DECI');
create type public.evaluation_status as enum ('draft', 'submitted');

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  full_name    text not null default '',
  role         public.app_role not null default 'judge',
  status       public.account_status not null default 'pending',
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.governorates (
  code        text primary key,
  name        text not null unique,
  sort_order  int  not null default 0
);

create table public.score_levels (
  value        smallint primary key check (value between 1 and 5),
  label        text not null,
  description  text not null
);

create table public.rubric_templates (
  id                 text primary key,
  title              text not null,
  subtitle           text not null,
  source_pdf         text not null,
  scale_instruction  text not null,
  guidance           text not null,
  core_max           int  not null check (core_max > 0),
  bonus_max          int  not null check (bonus_max >= 0),
  created_at         timestamptz not null default now()
);

create table public.rubric_sections (
  id           text primary key,
  template_id  text not null references public.rubric_templates (id) on delete cascade,
  position     int  not null,
  title        text not null,
  weight       int  not null check (weight > 0),
  is_bonus     boolean not null default false,
  unique (template_id, position),
  unique (id, template_id, is_bonus)
);

create table public.rubric_criteria (
  id           text primary key,
  section_id   text not null,
  template_id  text not null,
  is_bonus     boolean not null,
  position     int  not null,
  title        text not null,
  description  text not null,
  max_points   smallint not null default 5 check (max_points = 5),
  unique (section_id, position),
  unique (id, template_id),
  foreign key (section_id, template_id, is_bonus)
    references public.rubric_sections (id, template_id, is_bonus) on delete cascade
);

create table public.competitions (
  code          text primary key,
  organization  public.organization_code not null,
  label         text not null,
  template_id   text not null references public.rubric_templates (id),
  sort_order    int  not null default 0,
  is_published  boolean not null default false,
  published_at  timestamptz,
  published_by  uuid references public.profiles (id) on delete set null,
  unique (organization, label)
);

create table public.levels (
  code              text primary key,
  organization      public.organization_code not null,
  label             text not null,
  competition_code  text not null references public.competitions (code),
  sort_order        int  not null default 0,
  unique (organization, label)
);

-- ---------------------------------------------------------------------------
-- Teams & assignments
-- ---------------------------------------------------------------------------
create table public.teams (
  id                uuid primary key default gen_random_uuid(),
  team_code         text not null check (btrim(team_code) <> '' and team_code = btrim(team_code)),
  name              text not null check (btrim(name) <> ''),
  project_name      text not null check (btrim(project_name) <> ''),
  level_code        text not null references public.levels (code),
  governorate_code  text not null references public.governorates (code),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index teams_team_code_key on public.teams (lower(team_code));
create index teams_level_idx on public.teams (level_code);
create index teams_governorate_idx on public.teams (governorate_code);

create table public.team_judges (
  team_id      uuid not null references public.teams (id) on delete cascade,
  judge_id     uuid not null references public.profiles (id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  assigned_by  uuid references public.profiles (id) on delete set null,
  primary key (team_id, judge_id)
);
create index team_judges_judge_idx on public.team_judges (judge_id);

-- ---------------------------------------------------------------------------
-- Evaluations
-- ---------------------------------------------------------------------------
create table public.evaluations (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references public.teams (id) on delete restrict,
  judge_id           uuid not null references public.profiles (id) on delete restrict,
  template_id        text not null references public.rubric_templates (id),
  status             public.evaluation_status not null default 'draft',
  core_total         int  not null default 0 check (core_total >= 0),
  bonus_total        int  not null default 0 check (bonus_total >= 0),
  core_scored_count  int  not null default 0,
  core_criteria_count int not null default 0,
  section_notes      jsonb not null default '{}'::jsonb check (jsonb_typeof(section_notes) = 'object'),
  overall_notes      text not null default '',
  submitted_at       timestamptz,
  reopened_count     int  not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- one evaluation per judge per team: re-submission can never duplicate results
  constraint evaluations_team_judge_key unique (team_id, judge_id),
  constraint evaluations_submitted_complete check (
    status = 'draft'
    or (submitted_at is not null and core_scored_count = core_criteria_count and core_criteria_count > 0)
  )
);
create index evaluations_judge_idx on public.evaluations (judge_id);
create index evaluations_team_status_idx on public.evaluations (team_id, status);

create table public.evaluation_scores (
  evaluation_id  uuid not null references public.evaluations (id) on delete cascade,
  criterion_id   text not null references public.rubric_criteria (id),
  score          smallint check (score between 1 and 5),
  note           text not null default '',
  updated_at     timestamptz not null default now(),
  primary key (evaluation_id, criterion_id)
);

-- ---------------------------------------------------------------------------
-- Audit & realtime signal
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_id       uuid,
  actor_email    text,
  action         text not null,
  entity         text not null,
  entity_id      text,
  team_id        uuid,
  evaluation_id  uuid,
  details        jsonb not null default '{}'::jsonb
);
create index audit_log_evaluation_idx on public.audit_log (evaluation_id, occurred_at desc);
create index audit_log_team_idx on public.audit_log (team_id, occurred_at desc);
create index audit_log_time_idx on public.audit_log (occurred_at desc);

create table public.results_signal (
  competition_code  text primary key references public.competitions (code) on delete cascade,
  changed_at        timestamptz not null default now(),
  version           bigint not null default 0
);
