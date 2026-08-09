const normalizeHostname = (value) =>
  String(value || "").trim().toLowerCase().replace(/\.$/, "");

const tenantDefinitions = [
  {
    id: "scherdel",
    hostnames: ["scherdel.meslula.sk"],
    companyId: String(import.meta.env.VITE_TENANT_SCHERDEL_COMPANY_ID || "").trim(),
    companyNameFragments: ["scherdel"],
    branding: {
      productName: "Scherdel MES",
      eyebrow: "Manufacturing Execution System",
      accent: "#0067a8",
      accentStrong: "#004c7a"
    },
    features: { overview: true, activity: true },
    refreshIntervalMs: 30_000,
    loadApp: () => import("./scherdel/ScherdelMesApp")
  },
  {
    id: "mlproduktion",
    hostnames: ["mlproduktion.meslula.sk"],
    companyId: String(import.meta.env.VITE_TENANT_MLPRODUKTION_COMPANY_ID || "").trim(),
    companyNameFragments: ["ml produktion"],
    branding: {
      productName: "ML Produktion MES",
      eyebrow: "Manufacturing Execution System",
      accent: "#245a8d",
      accentStrong: "#163d63"
    },
    uiVariant: "factory-os",
    features: { overview: true, activity: true },
    refreshIntervalMs: 30_000,
    loadApp: () => import("./mlproduktion/MLProduktionMesApp")
  }
];

function getDevelopmentTenantId(location) {
  if (!import.meta.env.DEV) return "";
  return new URLSearchParams(location.search).get("tenant")?.trim().toLowerCase() || "";
}

export function resolveTenant(location) {
  const hostname = normalizeHostname(location?.hostname);
  const developmentTenantId = getDevelopmentTenantId(location);
  return tenantDefinitions.find((tenant) =>
    tenant.hostnames.some((candidate) => normalizeHostname(candidate) === hostname) ||
    tenant.id === developmentTenantId
  ) || null;
}

export { tenantDefinitions };
