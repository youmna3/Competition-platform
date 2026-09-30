param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$IntervalSeconds = 2
)

$ErrorActionPreference = 'Stop'
if (-not $env:STAGING_DB_URL) { throw 'STAGING_DB_URL is required.' }
if ($env:STAGING_DB_URL -match 'kdkwctsqfpwreebhftyn') { throw 'Refusing to monitor the production database.' }
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'psql is required.' }

'timestamp,total,active,idle,idle_in_transaction,waiting' | Set-Content -LiteralPath $OutputPath
Write-Host 'Sampling staging PostgreSQL connections. Press Ctrl+C after k6 finishes.'
while ($true) {
  $sample = & psql $env:STAGING_DB_URL -X -qAt -F ',' -c @'
select now(),
       count(*),
       count(*) filter (where state='active'),
       count(*) filter (where state='idle'),
       count(*) filter (where state='idle in transaction'),
       count(*) filter (where wait_event is not null)
from pg_stat_activity
where datname=current_database();
'@
  if ($LASTEXITCODE -ne 0) { throw 'psql connection sampling failed.' }
  Add-Content -LiteralPath $OutputPath -Value $sample
  Start-Sleep -Seconds $IntervalSeconds
}
