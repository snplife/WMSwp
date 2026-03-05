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
- `VITE_DEAD_STOCK_DAYS` (optional, default `30`)
- `VITE_MAX_POSITIONS` (optional, default `100`)
- `VITE_LOGIN_USER` (simple app login username)
- `VITE_LOGIN_PASSWORD` (simple app login password)

Dead stock threshold and max number of positions can also be changed directly in the web UI (`Nastavenia`) and are saved in browser `localStorage`.

## 3) Run

```bash
npm run dev
```

## Expected columns in table

This UI is now aligned to your SQL:

- `stock(position, material_code, quantity)`
- `stock_history(event_key, action, position, material_code, note, created_at_ms)`

## Realtime note

Enable Realtime for used tables in Supabase dashboard: `Database -> Replication`.
