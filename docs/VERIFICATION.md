# Verification report

Every check below was run against this codebase except where the database-suite note explicitly identifies newly added assertions that still require a PostgreSQL/Supabase test environment.

## 1–2. Every digital rubric matches its PDF, including section maximums

`python3 scripts/verify_rubrics.py rubrics/pdf` extracts the text of each PDF and checks the following for all seven templates:

- the title, subtitle, scale instruction, general guidance and the five score-level descriptions are present word for word;
- every section title and every criterion title and description appears word for word in the PDF;
- `Section Weight: N points` appears in the PDF, and each weight equals rows × 5;
- the Score Summary maximums match, the core total is 100, and "CORE TOTAL 100" appears in the PDF;
- the "Optional Bonus – max N" value matches, and the bonus maximum equals bonus rows × 5;
- a **residual check**: once every known string and form label is removed, no text is left over. This proves there is no criterion in the PDF that is missing from the app.

The verifier covers every Grade 6 title and description, all section weights, the 100-point core total, and the three-row 15-point bonus. The additive Grade 6 migration independently rejects an incorrect row count, section weight, or total, and `src/lib/scoring.test.ts` asserts the same structure.

## 3–8. Database behaviour (`scripts/test_db.sh`, 163 assertions defined)

The previously executed suite covered 136 assertions. It now defines 27 additional assertions for DEMI Grade 5, DEMI Grade 6 and DECI Level 1: clone a published rubric, modify a criterion, add a bonus criterion, save, read the changes back, publish, and compare historical evaluations and result rows before and after publication. Those new database assertions require a PostgreSQL/Supabase test environment and have not been executed on the current Windows machine, where PostgreSQL and Docker are unavailable.

| Brief item | Evidence (assertions) |
|---|---|
| **3. Independent judges** | Judge 2 sees 0 of judge 1's evaluations or scores. Judge 2's attempts to save or submit judge 1's evaluation are rejected. Each judge gets a separate evaluation row. |
| **4. Averaging** | (85 + 95) / 2 = 90. Bonus (4 + 10) / 2 = 7, kept separate. (96 + 80) / 2 = 88. After a correction, (85 + 94) / 2 = 89.5. |
| **5. Incomplete never ranked** | A team with 1 of 2 judges submitted is hidden from judges, admins and the public, and its official average is null. A reopened evaluation removes the team. Adding a third judge makes the team pending again; removing that judge restores it. A form with 17 or 2 missing rows cannot be submitted, and a CHECK constraint forbids an incomplete submitted row. |
| **6. DEMI / DECI kept separate** | The DEMI filter returns no DECI rows and vice versa. Ranks are computed per competition. L4 and L5 teams are ranked together in the combined category and keep their actual level. The Level 4 filter works. |
| **7. Authorization and persistence** | Pending users cannot approve themselves or see teams. Judges cannot promote themselves, create teams, assign judges, publish, reopen or read admin results. Direct INSERT or UPDATE on evaluations or scores is denied. Anonymous visitors cannot read any table, can see only published boards, and cannot call internal functions. Disabled judges lose access immediately. |
| **7. Leaderboard updates** | Publishing, submitting, reopening and assignment changes each bump `results_signal`, which drives the Realtime refresh. |
| **8. No duplicates on resubmission** | `start_evaluation` called twice returns the same id. Submitting two more times returns the unchanged row, the scores stay locked, and the database keeps one row per (team, judge). `scripts/test_concurrency.sh` fires **20 simultaneous start+submit requests**: the result is 1 evaluation, 1 logged submission, and the correct total. |
| Validation | Scores of 0, 6, 3.5 and "4" are rejected. A criterion or section from a different rubric is rejected. Team IDs are unique regardless of case. Only approved judges can be assigned. |
| Import | An invalid file writes nothing (atomic) and reports row errors, including duplicate IDs within the file. A valid file inserts or updates by Team ID and assigns judges by email. |
| Audit | Score changes are logged with old and new values. Submissions and reopens are logged with the reason. |

## End-to-end browser test (`scripts/e2e/e2e.mjs`), passing

This run used a real **Supabase Auth (GoTrue v2.177) + PostgREST v12 + Postgres 16** stack with the project migrations applied, and the Vite app driven by Playwright/Chromium. It covered:

- sign-up through the UI, which lands on the pending page;
- admin approval through the UI;
- a CSV import of 4 teams plus one team registered by hand;
- judge 1 saving a draft, reloading the page with **10 of 10 scores and the note still there**, and confirming Submit stays disabled until the form is complete;
- a live total of 85, then a rapid triple-click on submit producing **exactly one** evaluation and one logged submission;
- judge 2 starting with a blank form, and being blocked from an unassigned team's URL;
- the leaderboard showing 90 for (85 + 95) / 2, a tie shown as `=1`/`=1`, DEMI and DECI kept apart, and Levels 4 & 5 ordering 92 above 88 with the Level 4 filter working;
- anonymous visitors seeing nothing until the admin publishes, and then only the Grade 4 board;
- dashboard counts, the admin read-only view, reopen with audit and removal from the rankings;
- the Excel export with all five sheets;
- a 390 px phone layout with no horizontal scrolling.

Console errors during the run: none, apart from Google Fonts being blocked in the sandbox.

Screenshots are in `docs/screenshots/`.

## Build and unit tests

- `tsc --noEmit` (strict): clean.
- `vite build`: succeeds.
- `vitest`: 27 tests passing (scoring, seven-template consistency, ranking, import parsing, draft validation, missing/failed API response handling, successful rubric hydration, admin-route protection, and side-effect-free rubric preview).
