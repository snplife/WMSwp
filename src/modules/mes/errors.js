export function isMissingMesDeviceUidColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("mes_hmi_terminals.device_uid") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}

export function isMissingMesJobRunEventsColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("mes_job_run_events.") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}

export function isMissingMesMachinesAutomationModeColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("mes_machines.automation_mode") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}

export function isMissingMesMachinesSignalModeColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("mes_machines.signal_mode") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}

export function isMissingMesEventLogTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    (message.includes("mes_event_log") || message.includes("mes_event_feed")) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}
