function normalizePositiveInteger(value, fallback, minimum = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, parsed);
}

function normalizeSelectedModuleKeys(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (item && typeof item === "object") {
            return item.key;
          }
          return "";
        })
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function normalizeBillingPriceValue(value) {
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

export function estimateWmsPricing(input = {}) {
  const employees = normalizePositiveInteger(input.employees, 0, 0);
  const users = normalizePositiveInteger(input.users, 1, 1);
  const warehouses = normalizePositiveInteger(input.warehouses, 1, 1);
  const needsCustomSupport = Boolean(input.needsCustomSupport);
  const selectedModules = normalizeSelectedModuleKeys(input.selectedModules);
  const isFreeBasic =
    selectedModules.length > 0 &&
    selectedModules.includes("invoicing") &&
    selectedModules.every((moduleKey) => moduleKey === "invoicing");

  let monthly = 90;
  let setup = 900;

  if (!isFreeBasic) {
    if (employees >= 150) {
      monthly = 549;
      setup = 4900;
    } else if (employees >= 50) {
      monthly = 279;
      setup = 2400;
    }

    if (users > 5) {
      monthly += (users - 5) * 9;
    }
    if (warehouses > 1) {
      monthly += (warehouses - 1) * 90;
      setup += (warehouses - 1) * 600;
    }
    if (needsCustomSupport) {
      monthly += 140;
      setup += 1200;
    }
  } else {
    monthly = 0;
    setup = 0;
  }

  const annual = monthly * 12;
  const annualDiscounted = Math.round(annual * 0.8);
  const annualMonthlyEquivalent = Math.round(annualDiscounted / 12);

  return {
    employees,
    users,
    warehouses,
    needsCustomSupport,
    selectedModules,
    isFreeBasic,
    monthly,
    setup,
    annual,
    annualDiscounted,
    annualMonthlyEquivalent,
    summary: isFreeBasic
      ? "Basic fakturacia zdarma"
      : employees >= 150
        ? "Mid-market nasadenie"
        : employees >= 50
          ? "Rastuca firma"
          : "Mensie nasadenie"
  };
}

export function normalizeBillingCycle(value) {
  return String(value || "").trim().toLowerCase() === "annual" ? "annual" : "monthly";
}

export function resolveBillingCycleConfig(estimate, billingCycle = "monthly") {
  const normalizedCycle = normalizeBillingCycle(billingCycle);
  const isAnnual = normalizedCycle === "annual";
  const amount = isAnnual ? estimate.annualDiscounted : estimate.monthly;

  return {
    cycle: normalizedCycle,
    amount,
    amountCents: Math.max(0, Math.round(amount * 100)),
    interval: isAnnual ? "year" : "month",
    intervalLabel: isAnnual ? "rocne" : "mesacne",
    planKey: estimate.isFreeBasic ? "basic_free" : isAnnual ? "annual" : "monthly",
    productName: estimate.isFreeBasic
      ? "Factory OS - Basic"
      : isAnnual
        ? "Factory OS - rocne predplatne"
        : "Factory OS - mesacne predplatne"
  };
}

export function isCompanyOnBasicFreePlan(company = {}) {
  const normalizedPlanKey = String(company?.billing_plan_key || "").trim().toLowerCase();
  if (normalizedPlanKey === "basic_free") {
    return true;
  }

  const normalizedStatus = String(company?.billing_status || "").trim().toLowerCase();
  const hasSubscription = Boolean(String(company?.billing_subscription_id || "").trim());
  const monthly = normalizeBillingPriceValue(company?.billing_price_monthly);
  const annual = normalizeBillingPriceValue(company?.billing_price_annual);
  const setup = normalizeBillingPriceValue(company?.billing_setup_fee);

  return !hasSubscription && normalizedStatus === "active" && monthly === 0 && annual === 0 && setup === 0;
}

export function buildBillingLineItemDescription(estimate) {
  if (estimate?.isFreeBasic) {
    return "Basic fakturacia a cenove ponuky zdarma";
  }

  const parts = [
    estimate.summary,
    `${estimate.users} pouzivatelov`,
    `${estimate.warehouses} sklad${estimate.warehouses === 1 ? "" : "y"}`,
    `${estimate.employees} zamestnancov`
  ];

  if (estimate.needsCustomSupport) {
    parts.push("prioritny support");
  }

  return parts.join(" | ");
}

export function resolveCompanyBillingPricing(company = {}, estimateInput = {}) {
  const estimate = estimateInput?.monthly !== undefined ? estimateInput : estimateWmsPricing(estimateInput);
  const monthlyOverride = normalizeBillingPriceValue(company?.billing_price_monthly);
  const annualOverride = normalizeBillingPriceValue(company?.billing_price_annual);
  const setupOverride = normalizeBillingPriceValue(company?.billing_setup_fee);
  const note = String(company?.billing_price_note || "").trim();
  const isFreeBasicPlan = isCompanyOnBasicFreePlan(company);
  const usesCustomPricing = monthlyOverride !== null || annualOverride !== null || setupOverride !== null || Boolean(note);
  const monthly = isFreeBasicPlan ? 0 : monthlyOverride ?? estimate.monthly;
  const annualDiscounted = isFreeBasicPlan ? 0 : annualOverride ?? estimate.annualDiscounted;
  const setup = isFreeBasicPlan ? 0 : setupOverride ?? estimate.setup;

  return {
    ...estimate,
    isFreeBasic: isFreeBasicPlan || estimate.isFreeBasic,
    monthly,
    annualDiscounted,
    annualMonthlyEquivalent: annualDiscounted > 0 ? Math.round(annualDiscounted / 12) : 0,
    setup,
    billingNote: note,
    usesCustomPricing
  };
}
