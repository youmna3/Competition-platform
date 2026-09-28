#!/usr/bin/env bash
# Fires 20 simultaneous start+submit requests for the same judge/team against
# the database left by scripts/test_db.sh and checks that exactly one
# evaluation exists and it was submitted exactly once.
set -euo pipefail
DB=${TEST_DB:-judging_test}
TEAM=$(psql -tAq -d "$DB" -c "select id from teams where team_code='T6'")
psql -tAq -d "$DB" -c "update profiles set status='approved' where email='judge3@example.com'" >/dev/null
J3=00000000-0000-0000-0000-000000000003
run() {
  psql -tAq -d "$DB" >/dev/null 2>&1 <<SQL || true
select set_config('request.jwt.claims', '{"sub":"$J3","role":"authenticated"}', false);
set role authenticated;
select submit_evaluation(start_evaluation('$TEAM'),
  (select jsonb_agg(jsonb_build_object('criterion_id', id, 'score', 4, 'note', '')) from rubric_criteria where template_id='DEMI_G5' and not is_bonus));
SQL
}
for i in $(seq 1 20); do run & done; wait
N=$(psql -tAq -d "$DB" -c "select count(*) from evaluations where team_id='$TEAM'")
S=$(psql -tAq -d "$DB" -c "select count(*) from audit_log where action='evaluation.submitted' and team_id='$TEAM'")
C=$(psql -tAq -d "$DB" -c "select core_total from evaluations where team_id='$TEAM'")
echo "evaluations=$N submissions_logged=$S core_total=$C"
[ "$N" = 1 ] && [ "$S" = 1 ] && [ "$C" = 80 ] && echo "CONCURRENCY TEST PASSED"
