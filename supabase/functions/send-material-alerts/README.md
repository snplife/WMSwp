# send-material-alerts

Supabase Edge Function, ktora:

- claimne batch z `public.email_alert_queue`
- ziska Microsoft Graph access token cez client credentials
- odosle email cez `users/{sender}/sendMail`
- oznaci queue riadky ako `sent` alebo `failed`

Potrebne Supabase secrets:

- `SUPABASE_SERVICE_ROLE_KEY` alebo `SB_SERVICE_ROLE_KEY`
- `MS_GRAPH_TENANT_ID`
- `MS_GRAPH_CLIENT_ID`
- `MS_GRAPH_CLIENT_SECRET`
- `MS_GRAPH_SENDER`
- optional `EMAIL_ALERT_BATCH_SIZE`
- optional `EMAIL_ALERT_MAX_ATTEMPTS`
- optional `EMAIL_ALERT_LOCK_MINUTES`

Deploy:

```bash
supabase functions deploy send-material-alerts
```

Set secrets:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set MS_GRAPH_TENANT_ID=...
supabase secrets set MS_GRAPH_CLIENT_ID=...
supabase secrets set MS_GRAPH_CLIENT_SECRET=...
supabase secrets set MS_GRAPH_SENDER=alerts@your-domain.com
```

Invoke:

```bash
supabase functions invoke send-material-alerts --no-verify-jwt
```

HTTP method:

- `GET` = healthcheck
- `POST` = spracuje queue
