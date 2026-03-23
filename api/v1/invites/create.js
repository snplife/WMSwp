import { sendJson, sendMethodNotAllowed } from "../../_lib/http.js";
import { requireAuthenticatedCompanyManager } from "../../_lib/userAuth.js";

function sanitizeText(value, maxLength = 240) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveSiteUrl(req) {
  const configured = String(process.env.VITE_SITE_URL || process.env.SITE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) {
    return configured;
  }

  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
  const protocol = String(req.headers["x-forwarded-proto"] || "https").trim();
  if (!host) {
    throw new Error("Missing site host configuration. Set VITE_SITE_URL.");
  }

  return `${protocol}://${host}`;
}

function buildInvitePermissionsList({ canManageOrders, canAccessMes }) {
  const items = [];
  if (canManageOrders) {
    items.push("Objednavky a workflow");
  }
  if (canAccessMes) {
    items.push("Vyrobne objednavky a manufacturing");
  }
  if (items.length === 0) {
    items.push("Zakladny firemny pristup");
  }
  return items;
}

function buildInvitePermissionsSummary(permissions) {
  return permissions.join(" | ");
}

function buildInviteMailText({ companyName, permissions, inviteUrl, inviterName }) {
  return [
    "Pozvanka do Factory OS",
    "",
    "Dobry den,",
    "",
    `boli ste pozvany do firmy ${companyName} v systeme Factory OS.`,
    `Rozsah pristupu: ${buildInvitePermissionsSummary(permissions)}.`,
    inviterName ? `Pozvanku vytvoril: ${inviterName}.` : "",
    "",
    "Pozvanku prijmete cez tento odkaz:",
    inviteUrl,
    "",
    "Ak uz mate ucet, pozvanka sa vam zobrazi aj po prihlaseni priamo v aplikacii.",
    "",
    "Factory OS"
  ]
    .filter(Boolean)
    .join("\n");
}

function buildInviteMailHtml({ companyName, permissions, inviteUrl, inviterName }) {
  const safeCompanyName = escapeHtml(companyName);
  const safeInviteUrl = escapeHtml(inviteUrl);
  const safeInviter = escapeHtml(inviterName);
  const permissionHtml = permissions
    .map(
      (permission) => `
        <span style="display:inline-flex;margin:0 8px 8px 0;padding:8px 12px;border-radius:999px;background:#eef4ff;border:1px solid #cdddff;color:#18457a;font-size:13px;font-weight:700;">
          ${escapeHtml(permission)}
        </span>
      `.trim()
    )
    .join("");

  return `
    <div style="margin:0;padding:32px 16px;background:#eff4fb;font-family:Arial,sans-serif;color:#16324a;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #d8e1ec;border-radius:28px;overflow:hidden;box-shadow:0 22px 60px rgba(13,36,62,0.12);">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#10293f 0%,#1f5f8b 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.76;margin-bottom:12px;">Factory OS</div>
          <h1 style="margin:0;font-size:30px;line-height:1.12;">Pozvanka do firmy ${safeCompanyName}</h1>
          <p style="margin:14px 0 0;font-size:15px;line-height:1.7;max-width:520px;opacity:0.9;">
            Pristup do systemu, dokumentov a internych firemnych modulov v jednom prostredi.
          </p>
        </div>
        <div style="padding:30px 32px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">
            Dobry den, boli ste pozvany do firmy <strong>${safeCompanyName}</strong> v systeme Factory OS.
          </p>

          <div style="padding:18px 20px;border:1px solid #d7e3f1;border-radius:20px;background:#f8fbff;margin-bottom:18px;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#6a7f93;margin-bottom:10px;">Co budete mat dostupne</div>
            <div>${permissionHtml}</div>
            ${safeInviter ? `<div style="margin-top:12px;font-size:14px;color:#597086;">Pozvanku vytvoril: ${safeInviter}</div>` : ""}
          </div>

          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px;">
            <a href="${safeInviteUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#1e6fd7;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">
              Otvorit pozvanku
            </a>
            <span style="font-size:13px;color:#597086;">Pozvanka sa vam zobrazi aj po prihlaseni, ak uz mate aktivny ucet.</span>
          </div>

          <div style="padding:16px 18px;border-radius:18px;background:#fff8ee;border:1px solid #f0ddb9;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#8b6a2f;margin-bottom:8px;">Priamy odkaz</div>
            <a href="${safeInviteUrl}" style="font-size:13px;line-height:1.6;word-break:break-all;color:#1e6fd7;text-decoration:none;">
              ${safeInviteUrl}
            </a>
          </div>
        </div>
      </div>
    </div>
  `.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res, ["POST"]);
  }

  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const auth = await requireAuthenticatedCompanyManager(req, payload.companyId);
    if (!auth.ok) {
      return sendJson(res, auth.status, {
        ok: false,
        error: auth.error
      });
    }

    const email = String(payload.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return sendJson(res, 400, {
        ok: false,
        error: "Zadaj platny email pre pozvanku."
      });
    }

    const canManageOrders = Boolean(payload.canManageOrders);
    const canAccessMes = Boolean(payload.canAccessMes);
    const inviterName = sanitizeText(auth.appUser?.username || auth.user?.email || "", 120);
    const permissions = buildInvitePermissionsList({ canManageOrders, canAccessMes });

    const { data: inviteRow, error: inviteError } = await auth.supabase
      .from("company_invites")
      .insert({
        company_id: auth.companyId,
        email,
        can_manage_orders: canManageOrders,
        can_access_mes: canAccessMes,
        created_by: auth.user?.id || null
      })
      .select("*")
      .single();

    if (inviteError) {
      throw new Error(inviteError.message || "Nepodarilo sa vytvorit pozvanku.");
    }

    const inviteToken = String(inviteRow?.token || "").trim();
    const siteUrl = resolveSiteUrl(req);
    const inviteUrl = inviteToken ? `${siteUrl}/?invite=${inviteToken}` : siteUrl;

    let mailQueued = false;
    let mailQueueError = "";

    const { error: queueError } = await auth.supabase.from("email_alert_queue").insert({
      company_id: auth.companyId,
      event_key: `company_invite:${inviteRow.id}`,
      action: "INVITE",
      material_code: "COMPANY_INVITE",
      position: sanitizeText(auth.company?.name || "Factory OS", 120),
      note: sanitizeText(`Pozvanka do firmy ${auth.company?.name || "Firma"}`, 240),
      created_at_ms: Date.now(),
      recipient_email: email,
      payload: {
        subject: `Pozvanka do ${sanitizeText(auth.company?.name || "Factory OS", 120)} | Factory OS`,
        text: buildInviteMailText({
          companyName: auth.company?.name || "Firma",
          permissions,
          inviteUrl,
          inviterName
        }),
        html: buildInviteMailHtml({
          companyName: auth.company?.name || "Firma",
          permissions,
          inviteUrl,
          inviterName
        }),
        category: "company_invite",
        invite_url: inviteUrl,
        company_name: sanitizeText(auth.company?.name || "Firma", 120),
        permissions_summary: buildInvitePermissionsSummary(permissions)
      }
    });

    if (queueError) {
      mailQueueError = queueError.message || "Queue insert failed.";
    } else {
      mailQueued = true;
    }

    return sendJson(res, 200, {
      ok: true,
      invite: {
        id: inviteRow.id,
        email: inviteRow.email,
        token: inviteToken,
        status: inviteRow.status,
        can_manage_orders: Boolean(inviteRow.can_manage_orders),
        can_access_mes: Boolean(inviteRow.can_access_mes),
        expires_at: inviteRow.expires_at
      },
      invite_url: inviteUrl,
      mail_queued: mailQueued,
      mail_queue_error: mailQueueError || null
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
