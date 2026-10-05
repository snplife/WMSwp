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
  if (["start", "resume"].includes(normalized)) {
    return "running";
  }
  if (["downtime_start", "pause", "stop", "ml"].includes(normalized)) {
    return "stopped";
  }
  return "";
}

export function getMesFaultTransitionFromEvent(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  if (payload.faulted === true) return true;
  if (payload.faulted === false) return false;

  const markers = [
    row?.event_type,
    row?.event_code,
    row?.note,
    payload.event_type,
    payload.compact_event
  ].map((value) => String(value || "").trim().toLowerCase());
  if (markers.some((value) => ["machine_fault_start", "fault_start"].includes(value))) return true;
  if (markers.some((value) => ["machine_fault_end", "fault_end"].includes(value))) return false;
  return null;
}

export function getMesMachineFaultState(events) {
  let latestTransition = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  events.forEach((row, index) => {
    const transition = getMesFaultTransitionFromEvent(row);
    if (transition === null) return;
    const parsedTimestamp = new Date(row?.happened_at || row?.created_at || 0).getTime();
    const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : index;
    if (timestamp >= latestTimestamp) {
      latestTimestamp = timestamp;
      latestTransition = transition;
    }
  });
  return latestTransition === true;
}
