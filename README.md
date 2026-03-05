# Supabase Monitor (React)

Simple React dashboard that reads and monitors one or multiple tables from Supabase in realtime.

## 1) Install

```bash
npm install
```

## 2) Configure env

Create `.env.local` from `.env.example` and fill values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_TABLES` (comma-separated, example: `stock,stock_history`)
- `VITE_USER_ROLES_TABLE` (optional, default `app_users`)
- `VITE_MASTER_EMAIL` (optional, this email is always treated as `master`)
- `VITE_INTERNAL_LOGIN_DOMAIN` (optional, default `wms.local`, used for generated internal emails from username)
- `VITE_DEAD_STOCK_DAYS` (optional, default `30`)
- `VITE_MAX_POSITIONS` (optional, default `100`)
- `VITE_HISTORY_LOOKBACK_DAYS` (optional, default `365`, history window used for stock analytics)
- `VITE_AUTO_REFRESH_MS` (optional, default `300000` = 5 min)

Dead stock threshold and max number of positions can also be changed directly in the web UI (`Nastavenia`) and are saved in browser `localStorage`.
Settings button is visible only for `master` account.

## Auth setup (master account)

1. Run SQL from `SQL Code.txt` to create/update `app_users` role mapping table.
2. Mark master account:
   - either insert role row with `role='master'` for `user_id`
   - or set `VITE_MASTER_EMAIL` to master account email
3. Keep `Authentication -> Providers -> Email -> Enable Email Signups` ON for this frontend-based user creation flow.

## Master dashboard

Master account sees `Master Dashboard` panel in app:
- create companies
- create new user (`username`, `password`, `role`)
- assign user to company
- change role (`user` / `master`) for existing users

Users log in by `username + password`. App converts username to internal email (`username@VITE_INTERNAL_LOGIN_DOMAIN`) for Supabase Auth.

Note: user creation in this implementation uses Supabase `signUp` endpoint from frontend.  
For strict master-only provisioning with email signups disabled, use a backend/Edge Function with `service_role`.
## 3) Run

```bash
npm run dev
```

## Expected columns in table

This UI is now aligned to your SQL:

- `companies(id, name)`
- `app_users(user_id, username, role, company_id, ...)`
- `stock(company_id, position, material_code, quantity)`
- `stock_history(event_key, company_id, action, position, material_code, note, created_at_ms)`

## Realtime note

Enable Realtime for used tables in Supabase dashboard: `Database -> Replication`.
