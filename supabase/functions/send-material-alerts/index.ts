import { createClient } from "npm:@supabase/supabase-js@2";

type AlertRow = {
  id: string;
  subscription_id: string | null;
  company_id: string;
  event_key: string;
  action: string;
  material_code: string;
  position: string;
  note: string;
  created_at_ms: number;
  recipient_email: string;
  attempts: number;
  payload: Record<string, unknown> | null;
  queued_at: string;
};

type GraphTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getServiceRoleKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (direct) {
    return direct;
  }

  const legacy = Deno.env.get("SB_SERVICE_ROLE_KEY")?.trim();
  if (legacy) {
    return legacy;
  }

  throw new Error("Missing required env: SUPABASE_SERVICE_ROLE_KEY or SB_SERVICE_ROLE_KEY");
}

function formatAlertTimestamp(createdAtMs: number): string {
  const date = new Date(createdAtMs);
  if (Number.isNaN(date.getTime())) {
    return String(createdAtMs);
  }

  return new Intl.DateTimeFormat("sk-SK", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Bratislava",
  }).format(date);
}

function buildMailSubject(alert: AlertRow): string {
  return `WMS alert: ${alert.material_code} ${alert.action}`;
}

function buildMailText(alert: AlertRow): string {
  return [
    "WMS material alert",
    "",
    `Material: ${alert.material_code}`,
    `Akcia: ${alert.action}`,
    `Pozicia: ${alert.position}`,
    `Cas: ${formatAlertTimestamp(alert.created_at_ms)}`,
    `Firma ID: ${alert.company_id}`,
    `Event key: ${alert.event_key}`,
    `Poznamka: ${alert.note || "-"}`,
    "",
    "Tento email bol odoslany automaticky z WMS alert queue.",
  ].join("\n");
}

async function fetchGraphAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const tokenUrl =
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json() as GraphTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Graph token request failed: ${payload.error_description || payload.error || response.statusText}`,
    );
  }

  return payload.access_token;
}

async function sendMailWithGraph(
  accessToken: string,
  senderUser: string,
  alert: AlertRow,
): Promise<void> {
  const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUser)}/sendMail`;

  const response = await fetch(sendMailUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: buildMailSubject(alert),
        body: {
          contentType: "Text",
          content: buildMailText(alert),
        },
        toRecipients: [
          {
            emailAddress: {
              address: alert.recipient_email,
            },
          },
        ],
      },
      saveToSentItems: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph sendMail failed: ${response.status} ${errorText}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return json({ ok: true, function: "send-material-alerts" });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = getServiceRoleKey();
    const tenantId = requiredEnv("MS_GRAPH_TENANT_ID");
    const clientId = requiredEnv("MS_GRAPH_CLIENT_ID");
    const clientSecret = requiredEnv("MS_GRAPH_CLIENT_SECRET");
    const senderUser = requiredEnv("MS_GRAPH_SENDER");
    const batchSize = Math.max(1, Number(Deno.env.get("EMAIL_ALERT_BATCH_SIZE") || "20"));
    const maxAttempts = Math.max(1, Number(Deno.env.get("EMAIL_ALERT_MAX_ATTEMPTS") || "5"));
    const lockMinutes = Math.max(1, Number(Deno.env.get("EMAIL_ALERT_LOCK_MINUTES") || "10"));

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await supabase.rpc("claim_email_alert_batch", {
      p_limit: batchSize,
      p_max_attempts: maxAttempts,
      p_lock_minutes: lockMinutes,
    });

    if (error) {
      throw new Error(`claim_email_alert_batch failed: ${error.message}`);
    }

    const alerts = (data || []) as AlertRow[];
    if (alerts.length === 0) {
      return json({ ok: true, claimed: 0, sent: 0, failed: 0 });
    }

    const accessToken = await fetchGraphAccessToken(tenantId, clientId, clientSecret);

    let sent = 0;
    let failed = 0;
    const failures: Array<{ id: string; email: string; error: string }> = [];

    for (const alert of alerts) {
      try {
        await sendMailWithGraph(accessToken, senderUser, alert);

        const { error: markSentError } = await supabase.rpc("mark_email_alert_sent", {
          p_id: alert.id,
        });

        if (markSentError) {
          throw new Error(`mark_email_alert_sent failed: ${markSentError.message}`);
        }

        sent += 1;
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError);

        const { error: markFailedError } = await supabase.rpc("mark_email_alert_failed", {
          p_id: alert.id,
          p_error: message,
        });

        failures.push({
          id: alert.id,
          email: alert.recipient_email,
          error: markFailedError
            ? `send failed: ${message}; mark failed also failed: ${markFailedError.message}`
            : message,
        });

        failed += 1;
      }
    }

    return json({
      ok: true,
      claimed: alerts.length,
      sent,
      failed,
      failures,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 500);
  }
});
