export function normalizeMesOperatorLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

export function buildMesOperatorKey(operatorUserId, operatorName) {
  const normalizedUserId = String(operatorUserId || "").trim();
  if (normalizedUserId) {
    return `user:${normalizedUserId}`;
  }
  const normalizedName = normalizeMesOperatorLookupValue(operatorName);
  if (normalizedName) {
    return `name:${normalizedName}`;
  }
  return "";
}

export function isMesLoginEvent(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  return ["ol", "login"].includes(normalized);
}

export function isMesLogoutEvent(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  return ["oso", "logout"].includes(normalized);
}

export function isMesAuthEvent(eventType) {
  return isMesLoginEvent(eventType) || isMesLogoutEvent(eventType);
}

export function getMesEventScopeKeys(row) {
  return Array.from(
    new Set([String(row?.machine_id || "").trim(), String(row?.workstation_id || "").trim(), String(row?.terminal_id || "").trim()].filter(Boolean))
  );
}

export function getMesEventOperatorLabel(row) {
  return String(row?.operator_name || row?.operator_id || row?.operator_user_id || "").trim();
}

export function buildMesEventIdentity(row) {
  return String(
    row?.terminal_event_id ||
      row?.id ||
      `${row?.terminal_id || ""}:${row?.machine_id || ""}:${row?.workstation_id || ""}:${row?.job_run_id || ""}:${row?.happened_at || row?.created_at || ""}:${row?.event_type || ""}`
  );
}

export function getMesStateTransitionFromEvent(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  if (["start", "resume", "good_count", "scrap_count"].includes(normalized)) {
    return "running";
  }
  if (["downtime_start", "pause", "stop", "ml"].includes(normalized)) {
    return "stopped";
  }
  return "";
}
