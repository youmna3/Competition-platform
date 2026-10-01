# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Judging platform for the iSchool DEMI and DECI competitions (Stage 3). React 18 + TypeScript + Vite + Tailwind SPA on Vercel, backed by Supabase (Postgres, Auth, RLS, Realtime, one Deno edge function). Two roles: **admin** and **judge**. The design is documented in `docs/ARCHITECTURE.md`, and test evidence is in `docs/VERIFICATION.md`.

## Commands

```bash
npm run dev            # Vite dev server on :5173; needs .env.local with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run build          # tsc -b && vite build
npm run typecheck      # tsc -b --noEmit
npm test               # vitest run (node env, src/**/*.test.ts only)
npx vitest run src/lib/scoring.test.ts      # single file
npx vitest run -t "name of test"            # single test by name

npm run verify:rubrics # checks rubrics/rubrics.json against the PDFs word for word (python3 + pdftotext or pypdf)

# Database suite: applies every migration to a scratch Postgres 15/16, then runs supabase/tests/[1-9]*.sql
PGHOST=... PGPORT=... PGUSER=postgres scripts/test_db.sh
scripts/test_concurrency.sh   # run after test_db.sh; 20 parallel submits must produce exactly one evaluation
```

Deploy the edge function with `supabase functions deploy admin-user-invitations --no-verify-jwt --use-api`. `scripts/e2e/` (Playwright against a local GoTrue + PostgREST stack) and `scripts/load/` (k6) are manual harnesses with machine-specific paths. Read their READMEs before using them.

## Deployment & Branch Flow

- **Branches:**
  - `main`: Active development branch. PRs trigger `.github/workflows/ci.yml`.
  - `production`: Protected production branch. PR merges trigger `.github/workflows/deploy.yml` (builds container image, pushes to GHCR, and deploys to VPS via SSH).
- **Server Deployment:**
  - Production runs containerized on VPS `187.6.165.32` (`ischool_competition_web:8080`) behind Caddy (`bua_caddy`) on the `student_net` network at `https://ischool-competition.devhubai.net`.
  - Deployment uses a restricted SSH forced-command key running `/home/fady_id/ischool-competition/deploy.sh <sha>`.
- **Rollback:**
  - GitHub Actions: Run `.github/workflows/deploy.yml` manually via `workflow_dispatch` with `action: rollback`.
  - CLI: `ssh -i <deploy_key> fady_id@187.6.165.32 "rollback"`. Re-deploys `.previous_tag` with zero downtime.

## Architecture

**The database is the source of truth for every rule.** Clients have no write grants on the evaluation tables. All writes go through `SECURITY DEFINER` RPCs (`start_evaluation`, `save_evaluation`, `submit_evaluation`, `admin_reopen_evaluation`, `admin_delete_team`, `admin_list_page`, …), and each RPC checks role, approval and assignment. The database recalculates totals on every save. Triggers lock submitted evaluations and keep rubric versions immutable. The frontend score in `src/lib/scoring.ts` is only a live preview. When you change a rule, change it in SQL first; changing the UI alone is never enough.

**Migrations (`supabase/migrations/`)** run in filename order. Many later migrations `create or replace` functions first defined in `..0002_functions.sql`. Examples: `submit_evaluation`, `get_leaderboard` and `handle_new_user` are each redefined several times. **The current behavior of a function is its definition in the latest migration that touches it**, so grep across all migrations before editing. Add a new timestamped migration rather than editing one that may already be applied. Production has applied migrations at least through `20260929000002`.

**Rubrics** are data-driven and versioned. `rubrics/rubrics.json` mirrors the PDFs in `rubrics/pdf/`. `scripts/gen_seed.py` (`npm run gen:seed`) regenerates migration `..0004_seed_reference.sql` from it, which overwrites an existing migration. Later rubric changes (DEMI Grade 6, the combined DECI Levels 4 & 5 `DECI_L45`) live in their own migrations. Published rubric versions are immutable. Admins clone a version into a draft, edit it, and publish. Every team is pinned to one template version, so evaluations from different versions are never averaged together. `RubricForm.tsx` renders all templates.

**Scoring rules** (see README §6; do not invent new ones): each row is scored 1–5 and worth 5 points, so the core total is always 100. The bonus is stored separately and never added to the core. Its maximum is 10, or 15 for `DEMI_G6` and `DECI_L45`. A team's official score is the mean of the submitted core totals of **all judges currently assigned** to it. If any assigned judge hasn't submitted, the team is pending and appears on no leaderboard. Ties share a rank via `RANK()`, with no tie-break. Levels L4 and L5 both map to `DECI_L45` but keep their actual level.

**Frontend layout:**
- `src/lib/api.ts` is the only module that talks to Supabase. Pages call its functions and never call `supabase.from`/`.rpc` directly. Paginated admin lists go through the single `admin_list_page(p_kind, …)` RPC.
- `src/lib/types.ts` holds the shared row types. The other `src/lib/*.ts` modules are pure logic (scoring, import parsing, judge progress, draft recovery, pagination) and are what the unit tests cover.
- `src/App.tsx` defines the routes. Every route except the auth pages is wrapped in `RequireAuth`, which enforces session → approved status → forced password change → role. The leaderboard is admin-only.
- `src/pages/judge/EvaluationPage.tsx` handles autosave: debounced, serialized, retried, flushed when the page is hidden, with local draft replay via `draftRecovery.ts`. Browser storage is used for nothing else.
- `LeaderboardPage.tsx` refreshes on Realtime `results_signal` events and also polls every 30 seconds.
- `supabase/functions/admin-user-invitations` is the only code that uses the service-role key. It handles invitations and temporary-password accounts. Public signup is blocked by a DB trigger.

**Tests that read source text:** several `*.test.ts` files (e.g. `src/privateAccess.test.ts`, `src/pages/admin/teamDeletion.test.ts`) use `readFileSync` to read `App.tsx`, `api.ts` or specific migration files, then assert on exact substrings. Renaming a route, changing an RPC call string or editing those migrations can break these tests even when behavior is unchanged.

## Conventions

- Path alias `@/` → `src/`. TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`.
- Branding: the theme lives in `tailwind.config.js` (iSchool blue `#056FEC`, orange `#FF7F1C`, yellow `#FFD700`). DEMI is shown in orange and DECI in blue. Buttons are pills, and Submit is orange. Shared primitives are in `src/components/ui.tsx`.
- Never put the `service_role` key in frontend code or Vercel env. Only the anon key belongs in the browser.
