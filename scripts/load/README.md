# Staging load and production-readiness checks

These scripts must run against a separate Supabase staging project. Every script refuses the production project ref `kdkwctsqfpwreebhftyn`.

## Prerequisites

- A Supabase staging project on the same plan/region intended for competition use.
- All repository migrations applied to staging.
- One approved staging administrator account.
- k6 0.49 or newer, Node.js, Supabase CLI, and `psql` for connection sampling.
- Staging Auth URL settings configured for the staging/Vercel preview URL.

Set these only in the operator shell; never commit them:

```powershell
$env:STAGING_PROJECT_REF='your-staging-ref'
$env:STAGING_SUPABASE_URL='https://your-staging-ref.supabase.co'
$env:STAGING_SUPABASE_ANON_KEY='...'
$env:STAGING_SUPABASE_SERVICE_ROLE_KEY='...'
$env:STAGING_DB_URL='postgresql://...'
$env:STAGING_ADMIN_EMAIL='staging-admin@example.com'
$env:STAGING_ADMIN_PASSWORD='...'
$env:CONFIRM_STAGING_SEED=$env:STAGING_PROJECT_REF
```

The service-role key is used only by the local fixture generator. It is never passed to k6, written to the fixture, or exposed to the frontend.

## Prepare staging

```powershell
npx supabase db push --project-ref $env:STAGING_PROJECT_REF --dry-run
npx supabase db push --project-ref $env:STAGING_PROJECT_REF --yes
node scripts/load/verify-migrations.mjs
node scripts/load/setup-staging.mjs
```

The generator creates/reuses 50 staging-only judges, creates separate run-specific teams for the 30- and 50-user tests, assigns all judges to the corresponding shared team, and writes an ignored `scripts/load/.staging-fixture.json` with mode `0600` where supported.

## Run security checks

```powershell
k6 run scripts/load/k6-security-smoke.js
```

This verifies anonymous team access, unassigned-team isolation, direct evaluation writes, administrator RPC access, account-management access, and public signup blocking.

## Run 30 simultaneous judges

Start connection sampling in a separate terminal:

```powershell
New-Item -ItemType Directory -Force scripts/load/results | Out-Null
./scripts/load/monitor-connections.ps1 -OutputPath scripts/load/results/connections-30.csv
```

Then run:

```powershell
$env:K6_USERS='30'
k6 run --summary-export scripts/load/results/summary-30.json scripts/load/k6-judging.js
```

## Run 50 simultaneous judges

Use the separate 50-user target in the same fixture:

```powershell
./scripts/load/monitor-connections.ps1 -OutputPath scripts/load/results/connections-50.csv
$env:K6_USERS='50'
k6 run --summary-export scripts/load/results/summary-50.json scripts/load/k6-judging.js
```

Each virtual user logs in, loads the assigned team and complete rubric, calls `start_evaluation` twice, performs two concurrent draft saves, refreshes the Auth session, reloads the saved draft, submits the complete evaluation, retries submission, and reads the leaderboard. Teardown verifies exact submission count, uniqueness of `(team_id, judge_id)`, submitted states, judge counts, calculated average, and the final leaderboard row.

Run the fixture generator again before repeating either size; submitted evaluations are intentionally immutable.

## Acceptance criteria

- `api_errors` and `http_req_failed`: below 1%.
- Login/rubric/submit p95: below 2 seconds.
- Draft-save and leaderboard p95: below 1.5 seconds.
- `lost_submissions`, `duplicate_evaluations`, and `incorrect_averages`: exactly zero.
- No sustained `idle in transaction` connections.
- Peak connection usage stays below 70% of the staging plan's database connection limit, leaving room for administrators, realtime, and recovery traffic.

Archive both summary JSON files, both connection CSV files, the k6 console output, and Supabase API/Postgres logs with timestamps.
