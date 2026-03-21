function normalizePositiveInteger(value, fallback, minimum = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, parsed);
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

  let monthly = 90;
  let setup = 900;

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

  const annual = monthly * 12;
  const annualDiscounted = Math.round(annual * 0.8);
  const annualMonthlyEquivalent = Math.round(annualDiscounted / 12);

  return {
    employees,
    users,
    warehouses,
    needsCustomSupport,
    monthly,
    setup,
    annual,
    annualDiscounted,
    annualMonthlyEquivalent,
    summary:
      employees >= 150
        ? "Mid-market nasadenie"
        : employees >= 50
          ? "Rastúca firma"
          : "Menšie nasadenie"
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
    intervalLabel: isAnnual ? "ročne" : "mesačne",
    planKey: isAnnual ? "annual" : "monthly",
    productName: isAnnual ? "WMS Online - ročné predplatné" : "WMS Online - mesačné predplatné"
  };
}

export function buildBillingLineItemDescription(estimate) {
  const parts = [
    estimate.summary,
    `${estimate.users} používateľov`,
    `${estimate.warehouses} sklad${estimate.warehouses === 1 ? "" : "y"}`,
    `${estimate.employees} zamestnancov`
  ];

  if (estimate.needsCustomSupport) {
    parts.push("prioritný support");
  }

  return parts.join(" | ");
}

export function resolveCompanyBillingPricing(company = {}, estimateInput = {}) {
  const estimate = estimateInput?.monthly !== undefined ? estimateInput : estimateWmsPricing(estimateInput);
  const monthlyOverride = normalizeBillingPriceValue(company?.billing_price_monthly);
  const annualOverride = normalizeBillingPriceValue(company?.billing_price_annual);
  const setupOverride = normalizeBillingPriceValue(company?.billing_setup_fee);
  const note = String(company?.billing_price_note || "").trim();
  const usesCustomPricing = monthlyOverride !== null || annualOverride !== null || setupOverride !== null || Boolean(note);
  const monthly = monthlyOverride ?? estimate.monthly;
  const annualDiscounted = annualOverride ?? estimate.annualDiscounted;
  const setup = setupOverride ?? estimate.setup;

  return {
    ...estimate,
    monthly,
    annualDiscounted,
    annualMonthlyEquivalent: annualDiscounted > 0 ? Math.round(annualDiscounted / 12) : 0,
    setup,
    billingNote: note,
    usesCustomPricing
  };
}
