psql -q -h /var/tmp/pgtest -p 54329 -U postgres -d supa <<'SQL'
truncate public.audit_log, public.evaluation_scores, public.evaluations, public.team_judges, public.teams cascade;
update public.competitions set is_published=false, published_at=null, published_by=null;
delete from public.profiles;
delete from auth.users;
SQL
