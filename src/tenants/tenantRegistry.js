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
      accent: "#146c5a",
      accentStrong: "#0a4f41"
    },
    features: { overview: true, activity: true },
    refreshIntervalMs: 30_000,
    loadApp: () => import("./scherdel/ScherdelMesApp")
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
