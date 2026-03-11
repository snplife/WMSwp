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
- `SUPABASE_URL` (server-side API only)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side API only)
- `VITE_SITE_URL` (optional, canonical/OG URL for SEO)
- `VITE_HOTJAR_ID` (optional, enables Hotjar in production)
- `VITE_HOTJAR_SNIPPET_VERSION` (optional, default `6`, use the `hjsv` value from Hotjar tracking code)
- `VITE_SUPABASE_TABLES` (comma-separated, example: `stock,stock_history`)
- `VITE_USER_ROLES_TABLE` (optional, default `app_users`)
- `VITE_MASTER_EMAIL` (optional, this email is always treated as `master`)
- `VITE_INTERNAL_LOGIN_DOMAIN` (optional, default `wms.local`, used for generated internal emails from username)
- `VITE_DEAD_STOCK_DAYS` (optional, default `30`)
- `VITE_MAX_POSITIONS` (optional fallback default `100`)
- `VITE_HISTORY_LOOKBACK_DAYS` (optional, default `365`, history window used for stock analytics)
- `VITE_AUTO_REFRESH_MS` (optional, default `300000` = 5 min)

Dead stock threshold is saved in browser `localStorage`.
Warehouse capacity (`Počet miest na sklade`) is saved per company in database and is available in the web UI for the active company.

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

## Stock API

This repo now includes a server-side read-only stock API for external systems.

Endpoint:

```bash
GET /api/v1/stock
```

Auth:

- `X-API-Key: <company-api-key>`
- or `Authorization: Bearer <company-api-key>`

Supported query params:

- `limit` (default `500`, max `5000`)
- `offset` (default `0`)
- `material_code` (exact match)
- `position` (exact match)

Required server env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Example:

```bash
curl -H "X-API-Key: YOUR_COMPANY_KEY" "https://your-domain.example/api/v1/stock?limit=100"
```

Response shape:

```json
{
  "ok": true,
  "company_id": "uuid",
  "filters": {
    "material_code": null,
    "position": null
  },
  "pagination": {
    "limit": 100,
    "offset": 0,
    "returned": 2,
    "total": 2
  },
  "items": [
    {
      "company_id": "uuid",
      "position": "A01",
      "material_code": "MAT-1001",
      "quantity": 12
    }
  ]
}
```

### SQL for API keys

Run this on Supabase before using `/api/v1/stock`:

```sql
create table if not exists public.company_api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  label text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes text[] not null default array['stock:read']::text[],
  is_active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (key_hash)
);

create index if not exists idx_company_api_keys_company
  on public.company_api_keys (company_id);

create index if not exists idx_company_api_keys_active
  on public.company_api_keys (company_id, is_active);

alter table public.company_api_keys enable row level security;

revoke all on public.company_api_keys from anon, authenticated;
```

Create one key and store only the returned raw value somewhere safe:

```sql
with generated as (
  select
    'stock-' || encode(gen_random_bytes(24), 'hex') as raw_key
),
inserted as (
  insert into public.company_api_keys (company_id, label, key_prefix, key_hash, scopes)
  select
    'YOUR-COMPANY-UUID'::uuid,
    'ERP read key',
    left(raw_key, 12),
    encode(digest(raw_key, 'sha256'), 'hex'),
    array['stock:read']::text[]
  from generated
  returning company_id
)
select
  inserted.company_id,
  generated.raw_key
from inserted
cross join generated;
```

## Expected columns in table

This UI is now aligned to your SQL:

- `companies(id, name)`
- `app_users(user_id, username, role, company_id, ...)`
- `stock(company_id, position, material_code, quantity)`
- `stock_history(event_key, company_id, action, position, material_code, note, created_at_ms)`

## Realtime note

Enable Realtime for used tables in Supabase dashboard: `Database -> Replication`.
