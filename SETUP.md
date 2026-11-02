# Setup / restore guide

Project: **SURF Lending dashboard** — static frontend + Vercel serverless functions in `api/`, with a Supabase (Postgres) database for historical snapshots and the activity feed.

Supabase project: `skyvrjdbdvvabhfxlqkz` → `https://skyvrjdbdvvabhfxlqkz.supabase.co`

## 1. Environment variables

Every variable, and where it has to be set:

| Variable | Used by | Where |
| --- | --- | --- |
| `SUPABASE_URL` | `api/snapshot.js`, `api/activity-snapshot.js`, `api/activity.js`, `api/graph.js` | Vercel + local `.env` |
| `SUPABASE_SERVICE_KEY` | same | Vercel + local `.env` |
| `SNAPSHOT_KEY` | `api/snapshot.js`, `api/activity-snapshot.js` (query param `?key=`) | Vercel + GitHub Actions secret |
| `BLOCKFROST_NETWORK` | `api/surf-dashboard.js` (selects the Koios host: `mainnet`, `preprod`, `preview`) | Vercel |
| `KOIOS_API_URL` | optional override for the Koios host | Vercel |

Copy `.env.example` to `.env` and fill it in for local runs (`vercel dev`). `.env` is gitignored — never commit the service key.

## 2. Restore the database

If the Supabase project still exists and was just paused, restore it from the dashboard (**Project Settings → General → Restore project**) and skip to step 2b.

**2a. Empty (or brand new) database**

1. Open the project → **SQL Editor** → **New query**.
2. Paste the whole of `schema.sql` and run it. It is idempotent, so re-running is harmless.
3. Confirm the three tables exist: `surf_protocol_snapshots`, `surf_pool_snapshots`, `surf_activities`.

**2b. Database with old data**

Check what is already there before running `schema.sql`, because `CREATE TABLE IF NOT EXISTS` will not alter an existing table:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name like 'surf_%'
order by table_name, ordinal_position;
```

- Columns look like `schema.sql` → nothing to do, keep the existing history.
- Tables exist but columns differ (e.g. `created_at` instead of `snapshot_at`) → the API will fail with "column does not exist". Either rename the columns to match `schema.sql`, or drop the historic tables and let the cron jobs rebuild them.

**2c. Keys**

Project **Settings → API**:

- **Project URL** → `SUPABASE_URL` (`https://skyvrjdbdvvabhfxlqkz.supabase.co`).
- **service_role** secret key → `SUPABASE_SERVICE_KEY`. In newer dashboards this is shown under *Secret keys* as the `service_role` JWT or `sb_secret_...` key. The API routes run server-side only, so the service key is correct here — it bypasses RLS, which is why RLS is enabled on all three tables in `schema.sql`.

`SNAPSHOT_KEY` is a secret you invent (e.g. `openssl rand -hex 24`). It only has to match between Vercel and the GitHub Actions workflow secret.

## 3. Deploy and schedule

1. Import `kvnhndrsn/surf-dashboard` into Vercel, add the variables from step 1 with the values from step 2, deploy.
2. The workflows in `.github/workflows/` call `https://surf-dashboard-hazel.vercel.app/...`. If the domain changes, update both files (or set a repository variable `APP_URL` and reference `${{ vars.APP_URL }}`).
3. Add `SNAPSHOT_KEY` as a GitHub Actions secret (**Settings → Secrets and variables → Actions**). Without it the cron jobs get `401 invalid key`.
4. Cron schedule: `snapshot.yml` hourly (charts/history), `activity-snapshot.yml` every 10 minutes (activity feed).

## 4. Verify

```bash
# populate one snapshot row by hand
curl -sS "https://<your-domain>/api/snapshot?key=<SNAPSHOT_KEY>"

# feed the activity table
curl -sS "https://<your-domain>/api/activity-snapshot?key=<SNAPSHOT_KEY>"

# read it back
curl -sS "https://<your-domain>/api/graph?type=protocol" | head -c 300
```

Or straight in the SQL editor:

```sql
select count(*), max(snapshot_at) from surf_protocol_snapshots;
select count(*), max(snapshot_at) from surf_pool_snapshots;
select count(*), max(activity_time) from surf_activities;
```

Charts read from these tables, so the Analytics tab stays empty until at least two snapshots exist.

## Troubleshooting

- **`FUNCTION_INVOCATION_FAILED` on `/api/snapshot`, `/api/graph`, `/api/activity`:** `createClient()` runs at module load, so a missing `SUPABASE_URL` or `SUPABASE_SERVICE_KEY` crashes the whole function before the handler can return a readable error. Set both and redeploy.
- **SURF tab shows price/stake but no holders:** holders come from Koios `asset_address_list`. If Koios rejects the call, `token` is `null` in `/api/surf-dashboard` and holder-dependent cards show `—`.
- **Analytics empty:** the graphs read `surf_protocol_snapshots` / `surf_pool_snapshots`. They stay empty until the hourly cron has stored at least one snapshot.
