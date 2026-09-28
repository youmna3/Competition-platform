#!/usr/bin/env bash
# Apply all migrations to a fresh local database and run the SQL test-suite.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test_db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-judging_test}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  psql -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f "$f" | { grep -v "^$" || true; }
done
for f in supabase/tests/[1-9]*.sql; do
  echo "running $f"
  psql -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f "$f" | { grep -v "^$" || true; }
done
echo "ALL DATABASE TESTS PASSED"
