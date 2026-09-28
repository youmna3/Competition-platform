# Architecture

## 1. Rubric analysis (from the seven PDFs)

Every PDF has the same shape:

- a header (Team Name / #, Project Name, Judge Name, Date);
- the shared "How to Score Every Row" 1–5 scale (Weak / Developing / Meets Expectations / Strong / Excellent) and general judging guidance;
- core sections, each with a printed **Section Weight**;
- rows (Specific Judging Task + What the Judge Should Look For), each with a 1–5 score and a judge note;
- an **Optional Bonus** section and a **Score Summary** table (Section / Maximum / Section Subtotal / Notes, then CORE TOTAL 100 and OPTIONAL BONUS recorded separately), followed by a free notes box.

Because each row is worth 5 points, a section's weight always equals its number of rows × 5.

| Template | Rubric | Sections: weight (rows) | Core | Bonus |
|---|---|---|---|---|
| `DEMI_G4` | App Lab Project | Problem, Research & Solution 20 (4) · UX & Prototype Design 15 (3) · Programming & Functionality 25 (5) · Testing & Improvement 15 (3) · Business & Value 10 (2) · Teamwork & Presentation 15 (3) | 100 | 2 rows, max 10 |
| `DEMI_G5` | Arduino + AI Project | Problem, Research & Solution 15 (3) · Hardware & System Design 25 (5) · Programming & AI Integration 20 (4) · Prototype, Testing & Improvement 15 (3) · Business & Value 10 (2) · Teamwork & Presentation 15 (3) | 100 | 2 rows, max 10 |
| `DEMI_G6` | Robotics + AI Project | Problem, Research & Solution 15 (3) · Hardware, System & Robotics 30 (6) · Programming & AI 20 (4) · Prototype & Testing 15 (3) · Business & Value 5 (1) · Teamwork & Presentation 15 (3) | 100 | **3 rows, max 15** |
| `DECI_L1` | MIT App Inventor + Kit | Problem, Research & Solution 15 (3) · System, Circuit & Kit Use 20 (4) · Programming Logic 20 (4) · MIT App Inventor & User Experience 15 (3) · Testing & Integration 10 (2) · Business & Value 5 (1) · Teamwork & Presentation 15 (3) | 100 | 2 rows, max 10 |
| `DECI_L2` | Arduino + Web Integration | Problem, Research & Solution 15 (3) · System, Circuit, Hardware & Kit 25 (5) · Programming & Control Logic 15 (3) · Web Interface Integration 15 (3) · Testing & Hardware Evidence 10 (2) · Business & Value 5 (1) · Teamwork & Presentation 15 (3) | 100 | 2 rows, max 10 |
| `DECI_L3` | ESP32 + Track Integration | Problem, Research & Solution 15 (3) · System, Hardware, IoT & Circuit 25 (5) · Programming & AI / Data 20 (4) · Digital Identity & Track Integration 10 (2) · Testing & Validation 10 (2) · Business & Value 5 (1) · Teamwork & Presentation 15 (3) | 100 | 2 rows, max 10 |
| `DECI_L45` | Combined Advanced Project | Problem Analysis & Complete Solution 10 (2) · Architecture, Hardware & Embedded IoT 25 (5) · AI, Data Processing & Data Science 20 (4) · Product, UX, Web & Cybersecurity 15 (3) · Business, Testing & Improvement 15 (3) · Teamwork & Presentation 15 (3) | 100 | **3 rows, max 15** |

**Notes on the PDFs**

- **15-point bonuses.** The Grade 6 and Levels 4 & 5 PDFs each print "Optional Bonus – max 15" and contain three bonus rows; those PDF values are preserved.
- **"Q&A" text.** The PDFs encode "Q&A" as `Q&A;` / `& &QA;`, which is a PDF encoding artefact. The rubric shows it as "Q&A".

## 2. Database design

```
auth.users ─1:1─ profiles(role admin|judge, status pending|approved|rejected|disabled)

rubric_templates ─< rubric_sections(weight, is_bonus) ─< rubric_criteria(title, description, max 5)
score_levels (1..5 labels + descriptions)

competitions (DEMI_G4, DEMI_G5, DEMI_G6, DECI_L1, DECI_L2, DECI_L3, DECI_L45) ── template_id, is_published
levels (G4, G5, G6, L1, L2, L3, L4, L5) ── competition_code   ← L4 and L5 both → DECI_L45
governorates (Alexandria, Cairo, Monufia, Assiut, Suez)

teams(team_code unique, name, project_name, level_code, governorate_code)
team_judges(team_id, judge_id)  PK(team_id, judge_id)            ← any number of judges per team
evaluations(team_id, judge_id, template_id, status draft|submitted,
            core_total, bonus_total, core_scored_count, section_notes, overall_notes)
            UNIQUE(team_id, judge_id)                               ← resubmission can never duplicate
evaluation_scores(evaluation_id, criterion_id, score 1..5 | null, note)  PK(evaluation_id, criterion_id)
audit_log(actor, action, entity, team_id, evaluation_id, details jsonb)
results_signal(competition_code, version)                          ← Realtime refresh trigger
```

**Data-driven rubrics.** A single form component and a single set of SQL functions handle all seven rubrics. `rubrics/rubrics.json` is checked against every PDF by `scripts/verify_rubrics.py`. Grade 6 is installed by additive migration `20260928000005_add_demi_grade_6.sql`; the original migrations remain unchanged.

### Integrity guarantees in the database

- Scores must be whole numbers from 1 to 5 (CHECK and RPC validation). Every row's `max_points` is 5.
- A criterion must belong to the evaluation's own rubric (trigger).
- Totals are always recalculated on the server. Tampering with them from the client isn't possible, because clients have no write rights on the evaluation tables.
- Submitting requires every core row to be scored. This is enforced by the RPC and also by a CHECK constraint on the `evaluations` table.
- Submitted evaluations are locked by a trigger, even against direct SQL. Only the admin reopen action unlocks one, and it requires a reason that is recorded in the audit log.
- A team's grade/level cannot move to another rubric once evaluations exist. L4 ↔ L5 is allowed, since both use the same rubric.
- A team that has evaluations cannot be deleted (`ON DELETE RESTRICT`).
- Only approved accounts can be assigned to teams. The last active admin cannot be demoted or disabled.

### Security model (RLS + SECURITY DEFINER RPCs)

| Data | Judge (approved) | Admin | Anonymous |
|---|---|---|---|
| teams | only assigned teams | all (CRUD) | – |
| team_judges | own rows | all (CRUD) | – |
| evaluations / scores | **own only** (read) | read all | – |
| writes to evaluations | only through `start_evaluation`, `save_evaluation`, `submit_evaluation` (each checks ownership, approval and assignment) | `admin_reopen_evaluation` | – |
| profiles | self (can edit name only) | all; role/status changes | – |
| audit_log | – | read | – |
| leaderboards | `get_leaderboard` → published, complete teams only | everything, including unpublished boards | published, complete teams only |

Pending, rejected and disabled accounts see nothing.

### Results

`_team_results()` (internal) computes, for each team:

- `judges_required` = the number of judges currently assigned;
- `judges_submitted` = the number of those judges who have submitted;
- `is_complete` = required > 0 and submitted = required;
- `avg_core` and `avg_bonus` (arithmetic means, kept separate). These are null until the team is complete. Admins also see a *provisional* average, clearly labelled as not official.

`get_leaderboard()` ranks complete teams within each competition using `RANK()` (ties share a rank; no tie-break is applied).

## 3. Frontend

- `src/components/RubricForm.tsx` is one renderer for all seven templates. It covers the header, the scale legend, the sections with 1–5 radio buttons and notes, the bonus section, and the Score Summary.
- `src/pages/judge/EvaluationPage.tsx` handles saving. Changes are queued with a debounce; saves run one at a time and retry automatically. Unsaved changes are flushed when the tab is hidden or the page is left. Submitting sends the complete on-screen state.
- `src/pages/LeaderboardPage.tsx` shows DEMI and DECI tabs, the filters and publish controls. It refreshes on Realtime `results_signal` events and also polls every 30 seconds.
- Admin pages cover the dashboard, teams (CRUD, import, assignment, bulk assign), judges (approval and roles), evaluations (per-judge view and reopen), read-only rubric management/preview, and the audit log.
- Exports use ExcelJS, loaded only when needed. The workbook has five sheets: Official Leaderboard, All Teams Status, Judge Evaluations (with section subtotals), Criterion Scores, and Audit Log.
- Browser storage is not used for any data. Supabase Auth keeps only its session token there.
