# DEMI · DECI Judges Evaluation & Competition Platform

A web app for Stage 3 judging of the DEMI and DECI competitions. It is built with **React + TypeScript + Tailwind CSS**, uses **Supabase** (Postgres, Auth, Row Level Security, Realtime) for data and login, and deploys on **Vercel**.

- Seven digital rubrics, stored in the database and taken word for word from the PDFs. One scoring engine runs all seven.
- Two roles. **Administrators** manage judges, teams, assignments, publication and exports. **Judges** can only see and score the teams assigned to them.
- Drafts save automatically. A form cannot be submitted until every core row is scored. Submitting twice (for example a double-click) never creates a duplicate.
- Each judge's evaluation is stored separately. A team's official score is the **arithmetic mean of all its assigned judges' submitted core scores**, and the bonus is averaged separately.
- Leaderboards are kept separate for DEMI and DECI, and for each grade or level. They can be filtered by governorate. Only teams whose evaluations are all submitted are shown, and they update live. Administrators control whether each board is published.
- The admin dashboard, per-judge submission view, audit log of every score change, reopen workflow, CSV/Excel import and multi-sheet Excel export are all included.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design and [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for the test evidence.

---

## 1. Project layout

```
rubrics/rubrics.json          Single source of truth for the seven rubrics (verified against the PDFs)
rubrics/pdf/                  The original PDF rubrics
supabase/migrations/          SQL migrations — run in filename order
  ..0001_schema.sql           tables, enums, constraints
  ..0002_functions.sql        triggers, audit, scoring, RPC endpoints, leaderboards
  ..0003_security.sql         RLS policies, privileges, realtime
  ..0004_seed_reference.sql   original governorates, competitions, levels and six rubrics
  ..0005_add_demi_grade_6.sql additive DEMI Grade 6 rubric and competition
  ..0006_rubric_version_management.sql immutable versions, drafts and publishing
supabase/tests/               SQL test-suite (136 assertions) + a tiny Supabase stub for plain Postgres
scripts/verify_rubrics.py     Checks rubrics.json against the PDF text (every word, weight, maximum)
scripts/gen_seed.py           Regenerates migration 0004 from rubrics.json
scripts/test_db.sh            Runs all migrations + SQL tests on a scratch Postgres
scripts/test_concurrency.sh   20 simultaneous submissions → exactly one result
scripts/e2e/                  Browser end-to-end test (Playwright) + local stack helpers
src/                          React application
```

## 2. Create the Supabase project

1. Create a project at <https://supabase.com> and choose a nearby region (e.g. Frankfurt, `eu-central-1`).
2. **Run the migrations** using **one** of these two options:
   - **Option A: SQL Editor.** Open *SQL Editor → New query*. Paste and run each file in `supabase/migrations/` **in order** (0001 → 0004).
   - **Option B: Supabase CLI.**
     ```bash
     npm i -g supabase
     supabase init            # answer "no" to overwriting; keeps supabase/migrations
     supabase login
     supabase link --project-ref YOUR-PROJECT-REF
     supabase db push
     ```
3. **Set up authentication** in *Authentication → Sign In / Providers*:
   - Enable the **Email** provider (email and password).
   - Keep **Confirm email** turned on (recommended). New judges confirm their email, then wait for an administrator to approve them.
   - Under *Authentication → URL Configuration*, set **Site URL** to your Vercel URL (e.g. `https://judging.example.com`). Add these **Redirect URLs**: `https://judging.example.com/**` and `http://localhost:5173/**`.
   - For production email, set up a custom SMTP sender under *Authentication → Emails → SMTP*. Supabase's built-in sender is heavily rate-limited.
4. **Check that Realtime is on** for leaderboards: *Database → Publications → supabase_realtime* should include `results_signal`. Migration 0003 adds it automatically. If Realtime is ever off, the pages still refresh every 30 seconds.
5. **Create the first administrator.** Sign up through the app (`/signup`), then run this once in the SQL Editor:
   ```sql
   update public.profiles set role = 'admin', status = 'approved'
   where email = 'you@ischooltech.com';
   ```
   From then on, administrators approve judges and promote other admins from **Judges & accounts**. The database will not let you disable or demote the last active admin.
6. Copy **Project URL** and the **anon public key** from *Project Settings → API*.

> The anon key is safe to use in the browser. Every table is protected by RLS, and every write goes through validated database functions. **Never** put the `service_role` key in the frontend.

## 3. Run locally

```bash
cp .env.example .env.local      # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev                     # http://localhost:5173
```

Other scripts: `npm run build`, `npm test` (unit tests), `npm run typecheck`, `npm run verify:rubrics`.

## 4. Deploy to Vercel

1. Push this folder to a Git repository (GitHub, GitLab or Bitbucket).
2. In Vercel, choose **Add New → Project** and import the repository. The framework is detected as **Vite**, and `vercel.json` sets the build command, output folder, SPA rewrites and security headers.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production and Preview.
4. Click **Deploy**. Then add the production URL to Supabase's **Site URL** and **Redirect URLs** (step 2.3).

To deploy from the CLI instead: `npm i -g vercel && vercel --prod`, after setting the env vars with `vercel env add`.

## 5. Day-to-day use

| Who | Where | What |
|---|---|---|
| Judge | `/signup` → `/pending` | Register. Access starts once an admin approves. |
| Admin | **Judges** | Approve or reject sign-ups, disable accounts, grant admin rights. |
| Admin | **Teams** | Register teams (unique ID, name, project, organization, grade/level, governorate) or **Import CSV/Excel**. There is a template to download. Assign one or more judges per team, or bulk-add judges to selected teams. |
| Judge | **My evaluations** | Choose **DEMI** or **DECI**, then the grade/level, then an assigned team. Score each row 1–5 and add notes. Drafts save automatically. Submit when every core row is scored. |
| Admin | **Evaluations** | Per-team progress. Open any judge's submission read-only, see its change history, and **reopen** it with a reason. |
| Admin | **Rubric Management** | Browse version history, edit a new draft visually, validate, preview, and publish immutable rubric versions. |
| Everyone | **Leaderboard** | DEMI and DECI tabs, grade/level and governorate filters, a trophy on the top team of each category, ties shown as `=1`. The public sees only boards an admin has **published**. |
| Admin | **Dashboard** | Totals, pending work, results by category and governorate, top teams, **Export all results** (.xlsx). |

**Import columns:** `Team ID, Team Name, Project Name, Organization, Grade or Level, Governorate, Judge Emails`.
- Organization is `DEMI` or `DECI`.
- Grade or Level is `Grade 4`, `Grade 5`, `Grade 6`, or `Level 1`–`Level 5`.
- DECI Level 4 and Level 5 teams both use the shared Levels 4 & 5 rubric but keep their actual level.
- Judge emails are separated by `;` and must belong to approved accounts.
- An import is all-or-nothing, and rows are matched to existing teams by Team ID.

## 6. Scoring rules implemented (and what was *not* invented)

- Every row is scored 1–5 and worth 5 points, so each section's maximum equals its PDF weight. Each core total is 100.
- Core and bonus totals are **recalculated by the database** on every save. The browser total is only a live preview.
- The **optional bonus** is recorded separately and never added to the core. Its maximum comes from each PDF: **10**, except **DEMI Grade 6** and **DECI Levels 4 & 5**, which are **15** (three bonus rows each, as printed on those PDFs).
- A team's official score is the mean of the submitted core totals of **all judges currently assigned** to it. If any assigned judge hasn't submitted, the team is **pending**: it has no official score and doesn't appear on any leaderboard. Adding a judge makes the team pending again. An evaluation by a judge who has since been unassigned is kept, but it is not counted.
- **Ties** share a rank (standard competition ranking, `1, 1, 3`). No tie-break rule is applied, and bonus points are **not** used to break ties. That policy is left for the organizers to confirm.
- When the leaderboard is filtered (for example to Level 4 only, or to one governorate), ranks are recalculated within that view. The page says so when this happens.

## 7. iSchool branding

The UI follows the iSchool brand guidelines (<https://brand.ischooltech.com>):

- **Logos**: the official primary logo, the inverted (white) logo for blue backgrounds, and the icon mark are in `public/brand/`. They are used unmodified: the primary logo sits on white, the inverted logo on brand blue. The favicon is the icon mark.
- **Colours**: the whole theme is defined in `tailwind.config.js`.
  - Primary blue `#056FEC` (60%), orange `#FF7F1C` (30%) and yellow `#FFD700` (10%). The 60/30/10 split also appears as the brand stripe under the header.
  - Secondary colours: deep blue `#043FAD`, sky `#05ACFF`, and ice `#F7FAFF` for the page background.
  - Neutrals: `#E6EDF1`, `#B1D1E6`, `#85A5B9`, `#597587`, and navy `#1F2A55` for text.
  - Brand semantic colours for success, error and warning.
  - DEMI is shown in iSchool orange and DECI in iSchool blue.
- **Buttons** follow the brand UI design system. They are pill-shaped: blue for the main action, blue outline for secondary actions, and orange for the Submit action.
- **Typeface: Somar Rounded.** The licensed font files aren't bundled, and the brand site doesn't allow them to be loaded from another domain. Download the fonts from the brand site (*Typography → Download Fonts*). Copy `SomarRounded-Regular.ttf`, `-Medium.ttf`, `-SemiBold.ttf` and `-Bold.ttf` into `public/fonts/`, then redeploy. Until then, the app uses the rounded Google font Nunito.

## 8. Testing

```bash
# Rubric fidelity against the PDFs (needs pdftotext or the pypdf package)
python3 scripts/verify_rubrics.py rubrics/pdf

# Database: migrations + 136 assertions on a scratch Postgres 15/16
PGHOST=... PGPORT=... PGUSER=postgres scripts/test_db.sh
scripts/test_concurrency.sh

# Unit tests
npm test
```

`scripts/e2e/` contains the Playwright journey used to check the full app against a real GoTrue + PostgREST + Postgres stack. The results are in `docs/VERIFICATION.md`.
# Competition-platform
