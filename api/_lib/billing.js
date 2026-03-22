import crypto from "node:crypto";
import { buildBillingLineItemDescription, estimateWmsPricing, resolveBillingCycleConfig, resolveCompanyBillingPricing } from "../../shared/billingPricing.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const BILLING_STATUSES_WITH_ACTIVE_SUBSCRIPTION = new Set(["trialing", "active", "past_due", "unpaid", "incomplete"]);
const ROLE_TABLE = String(process.env.VITE_USER_ROLES_TABLE || "app_users").trim() || "app_users";
const MASTER_ORDER_NUMBER_PREFIX = "STRP";

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

function sanitizeText(value, maxLength = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeKey(value, maxLength = 48) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
}

function normalizePositiveInteger(value, fallback = 0, minimum = 0, maximum = 9999) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeMoneyValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function normalizeCheckoutSetup(setup = {}) {
  const selectedModules = Array.isArray(setup?.selectedModules)
    ? setup.selectedModules
        .map((item) => ({
          key: sanitizeKey(item?.key),
          label: sanitizeText(item?.label, 80),
          description: sanitizeText(item?.description, 180)
        }))
        .filter((item) => item.key && item.label)
        .slice(0, 12)
    : [];

  const hardwareItems = Array.isArray(setup?.hardwareItems)
    ? setup.hardwareItems
        .map((item) => ({
          key: sanitizeKey(item?.key),
          label: sanitizeText(item?.label, 80),
          description: sanitizeText(item?.description, 180),
          quantity: normalizePositiveInteger(item?.quantity, 1, 1, 999),
          unitPrice: normalizeMoneyValue(item?.unitPrice),
          moduleKeys: Array.isArray(item?.moduleKeys) ? item.moduleKeys.map((moduleKey) => sanitizeKey(moduleKey)).filter(Boolean).slice(0, 8) : []
        }))
        .filter((item) => item.key && item.label && item.quantity > 0)
        .slice(0, 20)
    : [];

  return {
    companyName: sanitizeText(setup?.companyName, 120),
    contactPhone: sanitizeText(setup?.contactPhone, 40),
    setupNote: sanitizeText(setup?.setupNote, 240),
    warehouseCount: normalizePositiveInteger(setup?.warehouseCount, 1, 1, 1000),
    employeeCount: normalizePositiveInteger(setup?.employeeCount, 0, 0, 100000),
    officeUserCount: normalizePositiveInteger(setup?.officeUserCount, 0, 0, 100000),
    wmsRackCount: normalizePositiveInteger(setup?.wmsRackCount, 0, 0, 10000),
    wmsPositionsPerRack: normalizePositiveInteger(setup?.wmsPositionsPerRack, 0, 0, 10000),
    skipWmsRackPlanning: Boolean(setup?.skipWmsRackPlanning),
    selectedModules,
    hardwareItems
  };
}

function encodeSetupModulesMetadata(selectedModules = []) {
  return selectedModules
    .map((item) => `${sanitizeKey(item.key)}~${sanitizeText(item.label, 60)}`)
    .join("|")
    .slice(0, 500);
}

function decodeSetupModulesMetadata(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [key, label] = item.split("~");
      return {
        key: sanitizeKey(key),
        label: sanitizeText(label, 80)
      };
    })
    .filter((item) => item.key && item.label);
}

function encodeSetupHardwareMetadata(hardwareItems = []) {
  return hardwareItems
    .map((item) => {
      const unitPrice = typeof item.unitPrice === "number" ? item.unitPrice.toFixed(2) : "";
      return `${sanitizeKey(item.key)}~${sanitizeText(item.label, 60)}~${normalizePositiveInteger(item.quantity, 1, 1, 999)}~${unitPrice}`;
    })
    .join("|")
    .slice(0, 500);
}

function decodeSetupHardwareMetadata(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [key, label, quantity, unitPrice] = item.split("~");
      return {
        key: sanitizeKey(key),
        label: sanitizeText(label, 80),
        quantity: normalizePositiveInteger(quantity, 1, 1, 999),
        unitPrice: normalizeMoneyValue(unitPrice)
      };
    })
    .filter((item) => item.key && item.label && item.quantity > 0);
}

function buildSetupSummary(setup) {
  const parts = [
    `${setup.employeeCount} zamestnancov`,
    `${setup.officeUserCount} office userov`,
    `${setup.warehouseCount} skladov`
  ];

  if (setup.wmsRackCount > 0 && setup.wmsPositionsPerRack > 0 && !setup.skipWmsRackPlanning) {
    parts.push(`${setup.wmsRackCount} regalov / ${setup.wmsPositionsPerRack} pozicii`);
  }

  return parts.join(" | ").slice(0, 500);
}

function buildMasterOrderNumber(sessionId) {
  const sanitizedId = String(sessionId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return `${MASTER_ORDER_NUMBER_PREFIX}-${sanitizedId.slice(-20) || Date.now()}`;
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

async function listCheckoutSessionLineItems(sessionId) {
  const payload = await stripeRequest(`/checkout/sessions/${sessionId}/line_items`, {
    data: {
      limit: 100
    }
  });

  return Array.isArray(payload?.data) ? payload.data : [];
}

async function resolveMasterSalesCompanyId(fallbackCompanyId = "") {
  const configuredCompanyId = String(process.env.MASTER_COMPANY_ID || "").trim();
  if (configuredCompanyId) {
    return configuredCompanyId;
  }

  const { data, error } = await getSupabaseAdmin()
    .from(ROLE_TABLE)
    .select("company_id")
    .eq("role", "master")
    .not("company_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`master company lookup failed: ${error.message}`);
  }

  return String(data?.[0]?.company_id || fallbackCompanyId || "").trim() || null;
}

async function findExistingCustomerByName(masterCompanyId, customerName) {
  const { data, error } = await getSupabaseAdmin()
    .from("customers")
    .select("id,name,email,phone,address,note")
    .eq("company_id", masterCompanyId)
    .ilike("name", customerName)
    .limit(1);

  if (error) {
    throw new Error(`master customer lookup failed: ${error.message}`);
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function ensureMasterCheckoutCustomer({ masterCompanyId, company, checkoutSession, setup }) {
  const customerName = sanitizeText(setup.companyName || company?.name, 120) || "Firma";
  const customerEmail = sanitizeText(
    checkoutSession?.customer_details?.email || company?.billing_email || "",
    120
  ).toLowerCase();
  const customerPhone = sanitizeText(setup.contactPhone || checkoutSession?.customer_details?.phone || "", 40);
  const addressParts = [
    sanitizeText(checkoutSession?.customer_details?.address?.line1, 120),
    sanitizeText(checkoutSession?.customer_details?.address?.line2, 120),
    sanitizeText(checkoutSession?.customer_details?.address?.postal_code, 40),
    sanitizeText(checkoutSession?.customer_details?.address?.city, 80),
    sanitizeText(checkoutSession?.customer_details?.address?.country, 40)
  ].filter(Boolean);
  const address = addressParts.join(", ");
  const customerNote = `Auto-created from Stripe checkout for company ${sanitizeText(company?.name, 120)} (${sanitizeText(company?.id, 60)}).`;
  const existingCustomer = await findExistingCustomerByName(masterCompanyId, customerName);

  if (existingCustomer?.id) {
    const { error: updateError } = await getSupabaseAdmin()
      .from("customers")
      .update({
        email: customerEmail || existingCustomer.email || null,
        phone: customerPhone || existingCustomer.phone || null,
        address: address || existingCustomer.address || null,
        note: customerNote
      })
      .eq("id", existingCustomer.id);

    if (updateError) {
      throw new Error(`master customer update failed: ${updateError.message}`);
    }

    return existingCustomer.id;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("customers")
    .insert([
      {
        company_id: masterCompanyId,
        name: customerName,
        email: customerEmail || null,
        phone: customerPhone || null,
        address: address || null,
        note: customerNote,
        created_by: null
      }
    ])
    .select("id")
    .single();

  if (error) {
    throw new Error(`master customer insert failed: ${error.message}`);
  }

  return data.id;
}

function buildSetupOrderItemsFromMetadata(setup) {
  const moduleItems = setup.selectedModules.map((moduleItem) => ({
    material_code: `Modul - ${moduleItem.label}`,
    position: "SOFTWARE",
    ordered_quantity: 1,
    stock_quantity_snapshot: 0,
    line_note: moduleItem.key ? `aktivovany modul: ${moduleItem.key}` : ""
  }));

  const hardwareItems = setup.hardwareItems.map((hardwareItem) => ({
    material_code: hardwareItem.label,
    position: "HARDWARE",
    ordered_quantity: hardwareItem.quantity,
    stock_quantity_snapshot: 0,
    line_note:
      typeof hardwareItem.unitPrice === "number"
        ? `orientacna cena ${hardwareItem.unitPrice.toFixed(2)} EUR bez DPH / ks`
        : "vyzaduje individualne nacenenie"
  }));

  return [...moduleItems, ...hardwareItems];
}

function buildStripeOrderItems(checkoutLineItems, setup) {
  const hardwareLabels = new Set(setup.hardwareItems.map((item) => item.label.toLowerCase()));

  return checkoutLineItems
    .map((lineItem) => {
      const label = sanitizeText(lineItem?.description || lineItem?.price?.nickname || "", 120);
      if (!label || hardwareLabels.has(label.toLowerCase())) {
        return null;
      }

      const quantity = normalizePositiveInteger(lineItem?.quantity, 1, 1, 999);
      const unitAmountCents =
        Number.isFinite(lineItem?.price?.unit_amount) && lineItem.price.unit_amount >= 0
          ? lineItem.price.unit_amount
          : Number.isFinite(lineItem?.amount_subtotal)
            ? Math.round(Number(lineItem.amount_subtotal) / quantity)
            : null;
      const recurringInterval = sanitizeText(lineItem?.price?.recurring?.interval || "", 20);
      const noteParts = [];
      if (Number.isFinite(unitAmountCents)) {
        noteParts.push(`${(unitAmountCents / 100).toFixed(2)} EUR / ks`);
      }
      if (recurringInterval) {
        noteParts.push(`opakovat ${recurringInterval}`);
      }

      return {
        material_code: label,
        position: recurringInterval ? "SUBSCRIPTION" : "SERVICE",
        ordered_quantity: quantity,
        stock_quantity_snapshot: 0,
        line_note: noteParts.join(" | ")
      };
    })
    .filter(Boolean);
}

async function createMasterOrderFromCheckoutSession({ company, checkoutSession }) {
  const masterCompanyId = await resolveMasterSalesCompanyId(String(company?.id || "").trim());
  if (!masterCompanyId) {
    return { created: false, reason: "master_company_not_found" };
  }

  const orderNumber = buildMasterOrderNumber(checkoutSession?.id);
  const { data: existingOrder, error: existingOrderError } = await getSupabaseAdmin()
    .from("orders")
    .select("id")
    .eq("company_id", masterCompanyId)
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (existingOrderError) {
    throw new Error(`master order lookup failed: ${existingOrderError.message}`);
  }

  if (existingOrder?.id) {
    return { created: false, reason: "already_exists", orderId: existingOrder.id };
  }

  const metadata = checkoutSession?.metadata && typeof checkoutSession.metadata === "object" ? checkoutSession.metadata : {};
  const setup = {
    companyName: sanitizeText(metadata.setup_company_name || company?.name, 120),
    contactPhone: sanitizeText(metadata.setup_contact_phone || "", 40),
    setupNote: sanitizeText(metadata.setup_note || "", 240),
    selectedModules: decodeSetupModulesMetadata(metadata.setup_modules),
    hardwareItems: decodeSetupHardwareMetadata(metadata.setup_hardware)
  };
  const checkoutLineItems = checkoutSession?.id ? await listCheckoutSessionLineItems(checkoutSession.id) : [];
  const customerId = await ensureMasterCheckoutCustomer({
    masterCompanyId,
    company,
    checkoutSession,
    setup
  });
  const orderItems = [...buildSetupOrderItemsFromMetadata(setup), ...buildStripeOrderItems(checkoutLineItems, setup)];

  if (orderItems.length === 0) {
    orderItems.push({
      material_code: "Stripe checkout",
      position: "SERVICE",
      ordered_quantity: 1,
      stock_quantity_snapshot: 0,
      line_note: sanitizeText(checkoutSession?.id, 120)
    });
  }

  const orderNoteParts = [
    `Stripe checkout ${sanitizeText(checkoutSession?.id, 120)}`,
    `firma ${sanitizeText(company?.name, 120)}`,
    metadata?.billing_cycle ? `cyklus ${sanitizeText(metadata.billing_cycle, 20)}` : "",
    setup?.setupNote ? sanitizeText(setup.setupNote, 240) : "",
    metadata?.setup_summary ? sanitizeText(metadata.setup_summary, 220) : ""
  ].filter(Boolean);

  const { data: orderRow, error: orderInsertError } = await getSupabaseAdmin()
    .from("orders")
    .insert([
      {
        company_id: masterCompanyId,
        customer_id: customerId,
        customer_name: sanitizeText(setup.companyName || company?.name, 120) || "Firma",
        order_number: orderNumber,
        note: orderNoteParts.join(" | ").slice(0, 1000),
        created_by: null
      }
    ])
    .select("id")
    .single();

  if (orderInsertError) {
    throw new Error(`master order insert failed: ${orderInsertError.message}`);
  }

  const { error: itemInsertError } = await getSupabaseAdmin()
    .from("order_items")
    .insert(orderItems.map((item) => ({ ...item, order_id: orderRow.id })));

  if (itemInsertError) {
    throw new Error(`master order item insert failed: ${itemInsertError.message}`);
  }

  return {
    created: true,
    orderId: orderRow.id,
    orderNumber,
    masterCompanyId
  };
}

export async function createCheckoutSession({ company, user, appUser, billingCycle, pricingInput, onboardingSetup, req }) {
  const normalizedStatus = normalizeBillingStatus(company?.billing_status);
  if (String(company?.billing_subscription_id || "").trim() && BILLING_STATUSES_WITH_ACTIVE_SUBSCRIPTION.has(normalizedStatus)) {
    throw new Error("Firma uz ma aktivne predplatne. Pouzi billing portal.");
  }

  const normalizedSetup = normalizeCheckoutSetup(onboardingSetup);
  const estimate = estimateWmsPricing({
    ...pricingInput,
    selectedModules: normalizedSetup.selectedModules.map((item) => item.key)
  });
  const effectivePricing = resolveCompanyBillingPricing(company, estimate);
  const cycleConfig = resolveBillingCycleConfig(effectivePricing, billingCycle);
  const selectedModuleSummary = normalizedSetup.selectedModules.map((item) => item.label).join(", ");
  const setupAmountCents = Number.isFinite(effectivePricing.setup) ? Math.max(0, Math.round(effectivePricing.setup * 100)) : 0;
  const includeSetupFee = !String(company?.billing_subscription_id || "").trim() && setupAmountCents > 0;
  const siteUrl = resolveSiteUrl(req);
  const successUrl = `${siteUrl}/?billing=success`;
  const cancelUrl = `${siteUrl}/?billing=cancel`;
  const lineItems = [];

  if (cycleConfig.amountCents > 0) {
    lineItems.push({
      price_data: {
        currency: "eur",
        product_data: {
          name: cycleConfig.productName,
          description: [effectivePricing.billingNote || buildBillingLineItemDescription(effectivePricing), selectedModuleSummary ? `Moduly: ${selectedModuleSummary}` : ""]
            .filter(Boolean)
            .join(" | ")
        },
        unit_amount: cycleConfig.amountCents,
        recurring: {
          interval: cycleConfig.interval
        }
      },
      quantity: 1
    });
  }

  if (includeSetupFee) {
    lineItems.push({
      price_data: {
        currency: "eur",
        product_data: {
          name: "Factory OS - onboarding a setup"
        },
        unit_amount: setupAmountCents
      },
      quantity: 1
    });
  }

  normalizedSetup.hardwareItems
    .filter((item) => typeof item.unitPrice === "number" && item.unitPrice > 0)
    .forEach((item) => {
      lineItems.push({
        price_data: {
          currency: "eur",
          product_data: {
            name: item.label,
            description: item.description || undefined
          },
          unit_amount: Math.round(item.unitPrice * 100)
        },
        quantity: item.quantity
      });
    });

  const metadata = {
    company_id: String(company?.id || "").trim(),
    company_name: String(company?.name || "").trim(),
    billing_cycle: cycleConfig.cycle,
    employees: String(estimate.employees),
    users: String(estimate.users),
    warehouses: String(estimate.warehouses),
    custom_support: estimate.needsCustomSupport ? "true" : "false",
    free_basic: effectivePricing.isFreeBasic ? "true" : "false",
    custom_pricing: effectivePricing.usesCustomPricing ? "true" : "false",
    setup_company_name: sanitizeText(normalizedSetup.companyName || company?.name, 120),
    setup_contact_phone: sanitizeText(normalizedSetup.contactPhone, 40),
    setup_note: sanitizeText(normalizedSetup.setupNote, 240),
    setup_modules: encodeSetupModulesMetadata(normalizedSetup.selectedModules),
    setup_hardware: encodeSetupHardwareMetadata(normalizedSetup.hardwareItems),
    setup_summary: buildSetupSummary(normalizedSetup)
  };

  if (lineItems.length === 0 && effectivePricing.isFreeBasic) {
    await updateCompanyBilling(company?.id, {
      billing_email: String(appUser?.email || user?.email || company?.billing_email || "").trim().toLowerCase() || null,
      billing_status: "active",
      billing_plan_key: "basic_free",
      billing_interval: null,
      billing_currency: "eur",
      billing_subscription_id: null,
      billing_price_id: null,
      billing_checkout_session_id: null,
      billing_cancel_at_period_end: false,
      billing_current_period_end: null
    });

    return {
      url: successUrl,
      sessionId: null,
      estimate: effectivePricing,
      cycle: cycleConfig.cycle,
      includesSetupFee: false,
      activatedDirectly: true
    };
  }

  const stripeCustomerId = await ensureStripeCustomer(company, {
    email: String(appUser?.email || user?.email || company?.billing_email || "").trim().toLowerCase(),
    name: String(company?.name || appUser?.username || user?.email || "").trim()
  });
  const checkoutMode = cycleConfig.amountCents > 0 ? "subscription" : "payment";

  const session = await stripeRequest("/checkout/sessions", {
    method: "POST",
    data: {
      mode: checkoutMode,
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
      ...(checkoutMode === "subscription"
        ? {
            subscription_data: {
              metadata
            }
          }
        : {})
    }
  });

  await updateCompanyBilling(company?.id, {
    stripe_customer_id: stripeCustomerId,
    billing_email: String(appUser?.email || user?.email || company?.billing_email || "").trim().toLowerCase() || null,
    billing_plan_key: cycleConfig.planKey,
    billing_interval: checkoutMode === "subscription" ? cycleConfig.interval : null,
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
    } else if (String(object?.metadata?.free_basic || "").trim() === "true") {
      await updateCompanyBilling(company.id, {
        billing_status: "active",
        billing_plan_key: "basic_free",
        billing_interval: null,
        billing_currency: "eur",
        billing_subscription_id: null,
        billing_price_id: null,
        billing_cancel_at_period_end: false,
        billing_current_period_end: null,
        billing_checkout_session_id: object?.id || null
      });
    }

    const masterOrder = await createMasterOrderFromCheckoutSession({
      company,
      checkoutSession: object
    });

    return {
      ignored: false,
      master_order_created: Boolean(masterOrder?.created),
      master_order_number: masterOrder?.orderNumber || null
    };
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
