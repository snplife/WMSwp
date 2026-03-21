import crypto from "node:crypto";
import { buildBillingLineItemDescription, estimateWmsPricing, resolveBillingCycleConfig, resolveCompanyBillingPricing } from "../../shared/billingPricing.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const BILLING_STATUSES_WITH_ACTIVE_SUBSCRIPTION = new Set(["trialing", "active", "past_due", "unpaid", "incomplete"]);

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function normalizeBillingStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) {
    return "inactive";
  }

  if (normalized === "cancelled") {
    return "canceled";
  }

  return normalized;
}

function appendFormValue(params, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFormValue(params, `${key}[${index}]`, item));
    return;
  }

  if (typeof value === "object") {
    Object.entries(value).forEach(([nestedKey, nestedValue]) => appendFormValue(params, `${key}[${nestedKey}]`, nestedValue));
    return;
  }

  params.append(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
}

async function stripeRequest(path, { method = "GET", data } = {}) {
  const stripeSecretKey = requiredEnv("STRIPE_SECRET_KEY");
  const upperMethod = String(method || "GET").toUpperCase();
  const headers = {
    Authorization: `Bearer ${stripeSecretKey}`
  };
  let url = `${STRIPE_API_BASE}${path}`;
  let body;

  if (upperMethod === "GET" && data && typeof data === "object") {
    const query = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => appendFormValue(query, key, value));
    if (Array.from(query.keys()).length > 0) {
      url = `${url}?${query.toString()}`;
    }
  } else if (data && typeof data === "object") {
    const params = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => appendFormValue(params, key, value));
    body = params.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(url, {
    method: upperMethod,
    headers,
    body
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage = payload?.error?.message || `Stripe request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return payload;
}

function resolveSiteUrl(req) {
  const configured = String(process.env.VITE_SITE_URL || process.env.SITE_URL || "").trim().replace(/\/+$/, "");
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

async function updateCompanyBilling(companyId, patch) {
  const normalizedCompanyId = String(companyId || "").trim();
  if (!normalizedCompanyId) {
    throw new Error("Missing company id for billing update.");
  }

  const payload = {
    ...patch,
    billing_updated_at: new Date().toISOString()
  };

  const { error } = await getSupabaseAdmin()
    .from("companies")
    .update(payload)
    .eq("id", normalizedCompanyId);

  if (error) {
    throw new Error(`company billing update failed: ${error.message}`);
  }
}

function extractSubscriptionState(subscription, extra = {}) {
  const stripeSubscription = subscription && typeof subscription === "object" ? subscription : {};
  const primaryItem = stripeSubscription.items?.data?.[0] || null;
  const price = primaryItem?.price || null;

  return {
    stripe_customer_id: stripeSubscription.customer || extra.customerId || null,
    billing_subscription_id: stripeSubscription.id || extra.subscriptionId || null,
    billing_price_id: price?.id || null,
    billing_plan_key: price?.recurring?.interval === "year" ? "annual" : price?.recurring?.interval === "month" ? "monthly" : null,
    billing_interval: price?.recurring?.interval || null,
    billing_currency: String(price?.currency || stripeSubscription.currency || "eur").trim().toLowerCase(),
    billing_status: normalizeBillingStatus(stripeSubscription.status),
    billing_cancel_at_period_end: Boolean(stripeSubscription.cancel_at_period_end),
    billing_current_period_end: stripeSubscription.current_period_end
      ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
      : null,
    billing_trial_ends_at: stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000).toISOString()
      : null,
    billing_checkout_session_id: extra.checkoutSessionId || undefined,
    billing_email: String(extra.billingEmail || "").trim().toLowerCase() || undefined
  };
}

async function findCompanyByBillingReference({ companyId, customerId, subscriptionId }) {
  const supabase = getSupabaseAdmin();
  const normalizedCompanyId = String(companyId || "").trim();
  if (normalizedCompanyId) {
    const { data, error } = await supabase.from("companies").select("*").eq("id", normalizedCompanyId).maybeSingle();
    if (error) {
      throw new Error(`company lookup by id failed: ${error.message}`);
    }
    if (data) {
      return data;
    }
  }

  const normalizedCustomerId = String(customerId || "").trim();
  if (normalizedCustomerId) {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("stripe_customer_id", normalizedCustomerId)
      .maybeSingle();

    if (error) {
      throw new Error(`company lookup by stripe customer failed: ${error.message}`);
    }
    if (data) {
      return data;
    }
  }

  const normalizedSubscriptionId = String(subscriptionId || "").trim();
  if (normalizedSubscriptionId) {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("billing_subscription_id", normalizedSubscriptionId)
      .maybeSingle();

    if (error) {
      throw new Error(`company lookup by stripe subscription failed: ${error.message}`);
    }
    if (data) {
      return data;
    }
  }

  return null;
}

export async function ensureStripeCustomer(company, { email, name }) {
  const existingCustomerId = String(company?.stripe_customer_id || "").trim();

  if (existingCustomerId) {
    return existingCustomerId;
  }

  const customer = await stripeRequest("/customers", {
    method: "POST",
    data: {
      email: String(email || "").trim().toLowerCase() || undefined,
      name: String(name || "").trim() || undefined,
      metadata: {
        company_id: String(company?.id || "").trim(),
        company_name: String(company?.name || "").trim()
      }
    }
  });

  await updateCompanyBilling(company?.id, {
    stripe_customer_id: customer.id,
    billing_email: String(email || "").trim().toLowerCase() || null
  });

  return customer.id;
}

export async function createCheckoutSession({ company, user, appUser, billingCycle, pricingInput, req }) {
  const normalizedStatus = normalizeBillingStatus(company?.billing_status);
  if (String(company?.billing_subscription_id || "").trim() && BILLING_STATUSES_WITH_ACTIVE_SUBSCRIPTION.has(normalizedStatus)) {
    throw new Error("Firma uz ma aktivne predplatne. Pouzi billing portal.");
  }

  const estimate = estimateWmsPricing(pricingInput);
  const effectivePricing = resolveCompanyBillingPricing(company, estimate);
  const cycleConfig = resolveBillingCycleConfig(effectivePricing, billingCycle);
  const stripeCustomerId = await ensureStripeCustomer(company, {
    email: String(appUser?.email || user?.email || company?.billing_email || "").trim().toLowerCase(),
    name: String(company?.name || appUser?.username || user?.email || "").trim()
  });
  const setupAmountCents = Number.isFinite(effectivePricing.setup) ? Math.max(0, Math.round(effectivePricing.setup * 100)) : 0;
  const includeSetupFee = !String(company?.billing_subscription_id || "").trim() && setupAmountCents > 0;
  const siteUrl = resolveSiteUrl(req);
  const successUrl = `${siteUrl}/?billing=success`;
  const cancelUrl = `${siteUrl}/?billing=cancel`;
  const lineItems = [
    {
      price_data: {
        currency: "eur",
        product_data: {
          name: cycleConfig.productName,
          description: effectivePricing.billingNote || buildBillingLineItemDescription(effectivePricing)
        },
        unit_amount: cycleConfig.amountCents,
        recurring: {
          interval: cycleConfig.interval
        }
      },
      quantity: 1
    }
  ];

  if (includeSetupFee) {
    lineItems.push({
      price_data: {
        currency: "eur",
        product_data: {
          name: "WMS Online - onboarding a setup"
        },
        unit_amount: setupAmountCents
      },
      quantity: 1
    });
  }

  const metadata = {
    company_id: String(company?.id || "").trim(),
    company_name: String(company?.name || "").trim(),
    billing_cycle: cycleConfig.cycle,
    employees: String(estimate.employees),
    users: String(estimate.users),
    warehouses: String(estimate.warehouses),
    custom_support: estimate.needsCustomSupport ? "true" : "false",
    custom_pricing: effectivePricing.usesCustomPricing ? "true" : "false"
  };

  const session = await stripeRequest("/checkout/sessions", {
    method: "POST",
    data: {
      mode: "subscription",
      customer: stripeCustomerId,
      client_reference_id: String(company?.id || "").trim(),
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: "required",
      customer_update: {
        address: "auto",
        name: "auto"
      },
      metadata,
      line_items: lineItems,
      subscription_data: {
        metadata
      }
    }
  });

  await updateCompanyBilling(company?.id, {
    stripe_customer_id: stripeCustomerId,
    billing_email: String(appUser?.email || user?.email || company?.billing_email || "").trim().toLowerCase() || null,
    billing_plan_key: cycleConfig.planKey,
    billing_interval: cycleConfig.interval,
    billing_currency: "eur",
    billing_checkout_session_id: session.id
  });

  return {
    url: session.url,
    sessionId: session.id,
    estimate: effectivePricing,
    cycle: cycleConfig.cycle,
    includesSetupFee: includeSetupFee
  };
}

export async function createBillingPortalSession({ company, req }) {
  const stripeCustomerId = String(company?.stripe_customer_id || "").trim();
  if (!stripeCustomerId) {
    throw new Error("Firma este nema Stripe customer profil.");
  }

  const siteUrl = resolveSiteUrl(req);
  const session = await stripeRequest("/billing_portal/sessions", {
    method: "POST",
    data: {
      customer: stripeCustomerId,
      return_url: `${siteUrl}/?billing=portal`
    }
  });

  return {
    url: session.url
  };
}

export async function syncCompanyFromStripeSubscription(companyId, subscription, extra = {}) {
  const state = extractSubscriptionState(subscription, extra);
  await updateCompanyBilling(companyId, state);
  return state;
}

export async function processStripeWebhookEvent(event) {
  const eventType = String(event?.type || "").trim();
  const object = event?.data?.object || {};

  if (eventType === "checkout.session.completed") {
    const company = await findCompanyByBillingReference({
      companyId: object?.metadata?.company_id || object?.client_reference_id,
      customerId: object?.customer,
      subscriptionId: object?.subscription
    });

    if (!company) {
      return { ignored: true, reason: "company_not_found" };
    }

    await updateCompanyBilling(company.id, {
      stripe_customer_id: object?.customer || company.stripe_customer_id || null,
      billing_email: String(object?.customer_details?.email || company.billing_email || "").trim().toLowerCase() || null,
      billing_checkout_session_id: object?.id || null
    });

    if (object?.subscription) {
      const subscription = await stripeRequest(`/subscriptions/${object.subscription}`);
      await syncCompanyFromStripeSubscription(company.id, subscription, {
        checkoutSessionId: object?.id || null,
        billingEmail: object?.customer_details?.email || company.billing_email || null
      });
    }

    return { ignored: false };
  }

  if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated" || eventType === "customer.subscription.deleted") {
    const company = await findCompanyByBillingReference({
      companyId: object?.metadata?.company_id,
      customerId: object?.customer,
      subscriptionId: object?.id
    });

    if (!company) {
      return { ignored: true, reason: "company_not_found" };
    }

    await syncCompanyFromStripeSubscription(company.id, object, {
      customerId: object?.customer || null
    });

    return { ignored: false };
  }

  return { ignored: true, reason: "unhandled_event" };
}

export function verifyStripeWebhookSignature(rawBody, signatureHeader) {
  const webhookSecret = requiredEnv("STRIPE_WEBHOOK_SECRET");
  const header = String(signatureHeader || "").trim();
  if (!header) {
    throw new Error("Missing Stripe-Signature header.");
  }

  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2) || "";
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));

  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid Stripe signature header.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) {
    throw new Error("Stripe signature timestamp is out of tolerance.");
  }

  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  const isValid = signatures.some((candidate) => {
    try {
      const candidateBuffer = Buffer.from(candidate, "hex");
      return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
    } catch {
      return false;
    }
  });

  if (!isValid) {
    throw new Error("Stripe signature verification failed.");
  }

  return JSON.parse(rawBody.toString("utf8"));
}
