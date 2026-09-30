# Production-readiness review

Review date: 2026-09-29

## Result status

The repository and linked-project review is complete, and a reproducible staging harness is available under `scripts/load/`. The requested 30- and 50-user measurements have **not** been executed because this workspace exposes only the live `Management System` Supabase project. k6, Docker/Podman, PostgreSQL, and a separate staging project are not available here. Production was not load-tested or seeded.

Do not interpret the thresholds in the scripts as measured results. Populate this table only from archived k6 output:

| Run | Average response | p95 response | API error rate | Lost | Duplicate | Incorrect average | Peak DB connections |
|---|---:|---:|---:|---:|---:|---:|---:|
| 30 judges | Not run | Not run | Not run | Not verified | Not verified | Not verified | Not measured |
| 50 judges | Not run | Not run | Not run | Not verified | Not verified | Not verified | Not measured |

## Verified by code and database review

- `evaluations(team_id, judge_id)` has a database unique constraint. `start_evaluation` uses `ON CONFLICT` and returns the existing row, preventing duplicate evaluations during retries.
- Save and submit RPCs lock the individual evaluation row with `SELECT ... FOR UPDATE`. Writes for one judge serialize without blocking other judges evaluating the same team.
- Assignments, evaluation ownership, score rows, exports, result aggregation, and leaderboard rows use internal UUIDs.
- Submitted evaluations are immutable. Score totals and averages are recomputed in PostgreSQL, not trusted from clients.
- Leaderboard completeness is based on submitted evaluations for the currently assigned judge UUIDs.
- RLS limits judges to assigned teams and their own evaluations. Direct evaluation/score table writes are not granted to clients.
- Public signup is blocked by the Auth trigger, account creation is administrator-provisioned, and account-management functions check approved administrator status.
- The linked production project reports every repository migration through `20260929000002` as applied. This is a read-only migration audit, not a production load test; staging migration parity remains unverified until staging exists.
- Browser autosave already serialized normal UI saves and retried transient errors. This review added local recovery for unsent changes so a refresh or hard interruption can replay pending scores and notes after the evaluation reloads.

## Risks and likely bottlenecks to measure

1. Each full submission updates roughly 20 core criteria plus bonus criteria individually. Fifty simultaneous submissions can generate more than 1,000 score updates and audit-trigger executions in a short burst. Measure `submit_time`, database CPU, locks, and connection wait time before considering a set-based RPC rewrite.
2. Leaderboards are calculated live from assignments and submitted evaluations. Realtime refreshes can cause many simultaneous leaderboard calls after submissions. The existing `team_judges(judge_id)`, `evaluations(team_id,status)`, and unique team/judge indexes help, but query latency must be measured with representative team counts.
3. A successful server draft is recoverable after refresh and session rotation. Browser-local recovery now protects pending UI changes, but a real browser offline/online test against staging is still required; k6 validates API persistence and refresh-token recovery, not browser lifecycle behavior.
4. Supabase plan connection limits cannot be inferred from HTTP timings. Run `monitor-connections.ps1` and inspect Supabase database/API dashboards during both tests.
5. Auth rate limits and e-mail delivery are deliberately excluded from the judging load test because accounts are pre-provisioned. Invitation delivery should be smoke-tested separately with the configured staging SMTP provider.

## Deployment checklist

1. Create a separate Supabase staging project in the intended region and plan tier.
2. Enable backups/PITR appropriate to the competition and record the recovery point.
3. Apply all migrations to staging and run `verify-migrations.mjs`.
4. Configure staging Auth redirect URLs, disable public signup in Supabase Auth settings, and deploy all Edge Functions with staging secrets.
5. Deploy the candidate frontend to a Vercel preview using only staging URL/anon-key variables.
6. Generate fixtures and run the security smoke test.
7. Run 30 users, archive results/logs, and confirm every threshold.
8. Generate fresh fixtures, run 50 users, archive results/logs, and confirm every threshold and connection headroom.
9. Manually test browser offline/online recovery, hard refresh with pending edits, token refresh, password reset, invitation acceptance, account deactivation, and administrator revocation.
10. Run the repository unit tests, database tests, typecheck, and production build.
11. Confirm production migration parity using a read-only migration list. Do not seed or load-test production.
12. Deploy during a quiet window, smoke-test one designated non-competition account, then remove it.

## Rollback procedure

1. Stop judge access or announce a brief judging pause if integrity is uncertain.
2. Promote the previous known-good Vercel deployment; do not rebuild during the incident.
3. Do not reverse additive database migrations by dropping columns or tables during live judging.
4. If bad application writes occurred, preserve logs, disable the affected write path, and restore/correct only from the recorded pre-deployment backup or PITR point after comparing submitted evaluation UUIDs and audit records.
5. Verify counts grouped by `(team_id, judge_id,status)`, recalculate team results, and compare published leaderboard rows before reopening judging.
6. Record the incident window, affected evaluation IDs, recovery action, and verification queries.
