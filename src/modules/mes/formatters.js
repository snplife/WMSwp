export function formatMesEventLabel(eventType) {
  const value = String(eventType || "").toLowerCase();
  if (value === "ol") return "Prihlásenie operátora";
  if (value === "oso") return "Odhlásenie operátora";
  if (value === "os") return "Načítanie zákazky";
  if (value === "of") return "Ukončenie zákazky";
  if (value === "ss") return "Odovzdanie zákazky";
  if (value === "ml") return "Materiál / automatický prestoj";
  if (value === "downtime_start") return "Začiatok prestoja";
  if (value === "downtime_end") return "Koniec prestoja";
  if (value === "assign") return "Priradenie zákazky";
  if (value === "queue") return "Zákazka v poradí";
  if (value === "pause") return "Pauza";
  if (value === "resume") return "Pokračovanie";
  if (value === "start") return "Štart výroby";
  if (value === "setup_start") return "Začiatok nastavenia";
  if (value === "setup_end") return "Koniec nastavenia";
  if (value === "complete") return "Dokončenie zákazky";
  if (value === "cancel") return "Zrušenie zákazky";
  if (value === "note") return "Poznámka";
  if (value === "stop") return "Stop";
  if (value === "good_count") return "OK kusy";
  if (value === "scrap_count") return "NOK kusy";
  return value || "-";
}

export function formatTimeOnly(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" });
}

export function getMesViewRole({ isMaster, canManageOrders, canAccessMes }) {
  if (isMaster) {
    return "management";
  }
  if (canManageOrders) {
    return "supervisor";
  }
  if (canAccessMes) {
    return "operator";
  }
  return "viewer";
}

export function getMesViewRoleLabel(role) {
  if (role === "management") return "Manažment";
  if (role === "supervisor") return "Supervízor";
  if (role === "operator") return "Operátor";
  return "Náhľad";
}

export function getMesStatusMeta(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["running", "run"].includes(normalized)) {
    return { label: "V PREVÁDZKE", tone: "running" };
  }
  if (["setup"].includes(normalized)) {
    return { label: "NASTAVENIE", tone: "setup" };
  }
  if (["alarm", "error", "down"].includes(normalized)) {
    return { label: normalized === "down" ? "ZASTAVENÉ" : "ALARM", tone: "alarm" };
  }
  if (["stopped", "stop", "maintenance", "offline"].includes(normalized)) {
    return { label: normalized === "maintenance" ? "ZASTAVENÉ" : normalized === "offline" ? "OFFLINE" : "ZASTAVENÉ", tone: "stopped" };
  }
  if (["paused"].includes(normalized)) {
    return { label: "ČAKANIE", tone: "idle" };
  }
  return { label: "ČAKANIE", tone: "idle" };
}

export function safeRatioPercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return (numerator / denominator) * 100;
}

export function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

export function formatEstimatedFinishTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function buildSimplePolyline(series, valueKey, maxValue) {
  if (!Array.isArray(series) || series.length === 0 || !Number.isFinite(maxValue) || maxValue <= 0) {
    return "";
  }
  return series
    .map((point, index) => {
      const x = series.length === 1 ? 50 : (index / (series.length - 1)) * 100;
      const y = 100 - (Math.max(0, Number(point?.[valueKey] || 0)) / maxValue) * 100;
      return `${x},${Math.max(0, Math.min(100, y))}`;
    })
    .join(" ");
}
