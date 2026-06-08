export function normalizeMesOverviewRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  return {
    ...row,
    workstation_active: Boolean(row.workstation_active),
    hmi_enabled: Boolean(row.hmi_enabled),
    planned_quantity: Number(row.planned_quantity || 0),
    good_quantity: Number(row.good_quantity || 0),
    scrap_quantity: Number(row.scrap_quantity || 0)
  };
}

export function normalizeMesJobRunRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  return {
    ...row,
    planned_quantity: Number(row.planned_quantity || 0),
    good_quantity: Number(row.good_quantity || 0),
    scrap_quantity: Number(row.scrap_quantity || 0)
  };
}

export function normalizeMesEventRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  return {
    ...row,
    company_id: String(row.company_id || "").trim(),
    terminal_id: String(row.terminal_id || "").trim(),
    terminal_code: String(row.terminal_code || row.payload?.terminal_code || "").trim().toUpperCase(),
    workstation_id: String(row.workstation_id || "").trim(),
    machine_id: String(row.machine_id || "").trim(),
    job_run_id: String(row.job_run_id || "").trim(),
    terminal_event_id: String(row.terminal_event_id || "").trim(),
    operator_user_id: String(row.operator_user_id || "").trim(),
    operator_name: String(row.operator_name || "").trim(),
    event_type: String(row.event_type || "").trim().toLowerCase(),
    event_code: String(row.event_code || "").trim().toLowerCase(),
    job_number: String(row.job_number || "").trim(),
    downtime_reason_code: String(row.downtime_reason_code || "").trim(),
    downtime_reason_name: String(row.downtime_reason_name || "").trim(),
    note: String(row.note || "").trim(),
    quantity: Number(row.quantity || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    time_from: row.time_from || null,
    time_to: row.time_to || null,
    happened_at: row.happened_at || row.created_at || null,
    created_at: row.created_at || row.happened_at || null,
    payload: row.payload && typeof row.payload === "object" ? row.payload : {}
  };
}

export function normalizeMesWorkstationRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  return {
    ...row,
    target_cycle_seconds: Number(row.target_cycle_seconds || 0),
    ideal_units_per_hour: Number(row.ideal_units_per_hour || 0),
    hmi_enabled: Boolean(row.hmi_enabled),
    is_active: Boolean(row.is_active)
  };
}

export function normalizeMesMachineCatalogRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  return {
    ...row,
    automation_mode: String(row.automation_mode || "full_automatic").trim().toLowerCase() || "full_automatic",
    signal_mode: normalizeMesSignalModeValue(row.signal_mode),
    is_active: Boolean(row.is_active)
  };
}

export function normalizeMesSignalModeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "nc" ? "nc" : "no";
}

export function formatMesSignalModeLabel(value) {
  return normalizeMesSignalModeValue(value).toUpperCase();
}

export function normalizeMesAutomationModeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "semi_automatic") {
    return "semi_automatic";
  }
  if (normalized === "full_automatic" || normalized === "automatic") {
    return "full_automatic";
  }
  return "";
}

export function resolveMesAutomationMode(machineMode, terminalMode) {
  return (
    normalizeMesAutomationModeValue(terminalMode) ||
    normalizeMesAutomationModeValue(machineMode) ||
    "full_automatic"
  );
}

export function normalizeMesTerminalRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  return {
    ...row,
    device_uid: String(row.device_uid || "").trim().toUpperCase(),
    terminal_code: String(row.terminal_code || "").trim().toUpperCase(),
    name: String(row.name || "").trim(),
    platform: String(row.platform || "").trim().toLowerCase(),
    app_mode: String(row.app_mode || "").trim().toLowerCase(),
    app_version: String(row.app_version || "").trim(),
    last_ip: String(row.last_ip || "").trim(),
    is_active: Boolean(row.is_active)
  };
}

export function formatMesTerminalPlatformLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "raspberry_pi") {
    return "Raspberry Pi";
  }
  if (normalized === "web_kiosk") {
    return "Webový kiosk";
  }
  if (normalized === "android") {
    return "Android";
  }
  return normalized || "-";
}

export function formatMesTerminalAppModeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "hmi") {
    return "HMI";
  }
  if (normalized === "overview") {
    return "Prehľad";
  }
  if (normalized === "maintenance") {
    return "Údržba";
  }
  if (normalized === "semi_automatic") {
    return "Poloautomatický";
  }
  if (normalized === "automatic" || normalized === "full_automatic") {
    return "Plne automatický";
  }
  return normalized || "-";
}

export function formatMesAutomationModeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "semi_automatic") {
    return "Poloautomatický";
  }
  if (normalized === "full_automatic") {
    return "Plne automatický";
  }
  return normalized || "-";
}

export function buildMesTerminalCodeFromDeviceUid(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized ? `UID-${normalized}` : "";
}

export function sanitizeMesTerminalCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

export function isMesTerminalOnline(lastSeenAt) {
  const lastSeenMs = Date.parse(String(lastSeenAt || ""));
  return Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= 5 * 60 * 1000;
}
