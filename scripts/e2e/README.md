# Local full-stack E2E harness

Used to verify the app end-to-end without a cloud project:

1. Postgres 15/16 with database `supa`. Create roles `anon`, `authenticated`, `service_role`, `authenticator` (login, noinherit, granted the first three) and `supabase_auth_admin`, plus schema `auth` owned by `supabase_auth_admin`.
2. Supabase Auth (GoTrue) binary: `set -a; . ./auth.env; set +a; ./auth migrate && ./auth serve`.
3. Apply `supabase/migrations/*.sql` in order.
4. PostgREST: `./postgrest pgrst.conf`. Then run the gateway `node proxy.mjs` on :54321, and generate the anon key with `node keys.mjs`.
5. Run `npm run dev` with `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the anon key.
6. Run `node e2e.mjs`, with `playwright` installed. Use `reset.sh` to wipe the data between runs.

Paths in these scripts point at the sandbox where they were run, so adjust them for your machine.

## Navigation-only responsive check

With the Vite app running on port 4173 and Playwright installed, run:

```powershell
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/e2e/navigation-responsive.mjs
```

The focused check uses a browser-local mocked administrator session by default; Supabase responses are intercepted and no records are created. To exercise a real test administrator instead, also set `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD`. Set `BASE_URL` when the app is not at `http://127.0.0.1:4173`.
