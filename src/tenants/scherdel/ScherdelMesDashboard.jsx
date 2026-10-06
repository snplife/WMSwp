import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, ClipboardList, Clock3,
  ChevronLeft, ChevronRight, Factory, Gauge, LogOut, PackageCheck, PauseCircle, PlayCircle,
  RefreshCw, ScanLine, Settings2, ShieldCheck, Square, Tags, UserRound, Wrench
} from "lucide-react";
import { supabase } from "../../supabaseClient";
import { getMesMachineFaultState } from "../../modules/mes/events";
import MesAnalyticsExports, { getMesAnalyticsRangeWindow, toDateInputValue } from "../shared/MesAnalyticsExports";
import ScherdelFactoryMap from "./ScherdelFactoryMap";
import {
  SCHERDEL_DEFECT_REASONS,
  SCHERDEL_DOWNTIME_REASONS,
  SCHERDEL_MACHINE_ACTIVITIES,
  SCHERDEL_OVERHEAD_ACTIVITIES,
  SCHERDEL_ROLE_LABELS
} from "./scherdelCatalogs";
import "./scherdelMesDashboard.css";

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused"]);
const numberFormatter = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 1 });
const SCHERDEL_SHIFTS = [
  { key: "morning", order: 1, name: "Ranná", time: "06:30 – 14:30", startHour: 6, startMinute: 30 },
  { key: "afternoon", order: 2, name: "Poobedná", time: "14:30 – 22:30", startHour: 14, startMinute: 30 },
  { key: "night", order: 3, name: "Nočná", time: "22:30 – 06:30", startHour: 22, startMinute: 30 }
];

function getShiftWindowMinutes(rangeWindow, shift) {
  const startMs = Number(rangeWindow?.startMs || 0);
  const endMs = Number(rangeWindow?.endMs || 0);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  const cursor = new Date(startMs);
  cursor.setDate(cursor.getDate() - 1);
  cursor.setHours(0, 0, 0, 0);
  const lastDay = new Date(endMs);
  lastDay.setHours(0, 0, 0, 0);
  let minutes = 0;
  while (cursor <= lastDay) {
    const shiftStart = new Date(cursor);
    shiftStart.setHours(shift.startHour, shift.startMinute, 0, 0);
    const shiftEnd = new Date(shiftStart.getTime() + 8 * 60 * 60 * 1000);
    const overlapStart = Math.max(startMs, shiftStart.getTime());
    const overlapEnd = Math.min(endMs, shiftEnd.getTime());
    minutes += Math.max(0, overlapEnd - overlapStart) / 60_000;
    cursor.setDate(cursor.getDate() + 1);
  }
  return minutes;
}

function isMissingMesEventColumnError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("mes_job_run_events") && (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

function formatNumber(value) {
  return numberFormatter.format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function getMachineKey(row) {
  return String(row?.machine_id || row?.workstation_id || "");
}

function matchesMachine(row, selectedRow) {
  if (!row || !selectedRow) return false;
  return (
    (selectedRow.machine_id && String(row.machine_id || "") === String(selectedRow.machine_id)) ||
    (selectedRow.workstation_id && String(row.workstation_id || "") === String(selectedRow.workstation_id)) ||
    (selectedRow.terminal_id && String(row.terminal_id || "") === String(selectedRow.terminal_id))
  );
}

function machineStatus(row) {
  const state = String(row?.machine_state || row?.job_status || "idle").toLowerCase();
  if (state === "running") return { key: "running", label: "Automatický cyklus" };
  if (state === "setup" || state === "queued") return { key: "setup", label: "Nastavenie" };
  if (state === "maintenance") return { key: "maintenance", label: "Servisný zásah" };
  if (state === "down" || state === "paused" || row?.current_downtime_reason) return { key: "downtime", label: "Prestoj" };
  if (state === "offline") return { key: "offline", label: "Offline" };
  return { key: "undefined", label: "Nedefinovaná výroba" };
}

function orderOutput(order) {
  return order?.production_order_outputs?.[0] || null;
}

function getProfileRole(profile) {
  return String(profile?.mes_role || profile?.role || "operator").toLowerCase();
}

export default function ScherdelMesDashboard({
  tenant, accessContext, overviewRows, jobRuns, mesEvents, workstations, downtimeReasons,
  productionOrders, dataLoading, dataError, lastLoadedAt, onRefresh, onSignOut
}) {
  const [activeSection, setActiveSection] = useState("live");
  const [selectedMachineKey, setSelectedMachineKey] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [manualJobNumber, setManualJobNumber] = useState("");
  const [manualItemCode, setManualItemCode] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("0");
  const [countQuantity, setCountQuantity] = useState("1");
  const [defectCode, setDefectCode] = useState("");
  const [downtimeCode, setDowntimeCode] = useState("");
  const [activityCode, setActivityCode] = useState("");
  const [activityNote, setActivityNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [oeeRangeKey, setOeeRangeKey] = useState("today");
  const [oeeCustomStart, setOeeCustomStart] = useState(() => toDateInputValue(new Date()));
  const [oeeCustomEnd, setOeeCustomEnd] = useState(() => toDateInputValue(new Date()));
  const [oeeReport, setOeeReport] = useState({
    rows: [],
    cycleCount: 0,
    runtimeMinutes: 0,
    quality: { good: 0, scrap: 0 },
    loading: true,
    error: "",
    rangeWindow: null
  });

  const sortedRows = useMemo(() => [...overviewRows].sort((left, right) =>
    String(left.machine_name || left.workstation_name || "").localeCompare(
      String(right.machine_name || right.workstation_name || ""), "sk-SK", { sensitivity: "base" }
    )
  ), [overviewRows]);

  useEffect(() => {
    if (selectedMachineKey.startsWith("slot:")) return;
    if (!sortedRows.some((row) => getMachineKey(row) === selectedMachineKey)) {
      setSelectedMachineKey(getMachineKey(sortedRows[0]));
    }
  }, [selectedMachineKey, sortedRows]);

  const selectedRow = sortedRows.find((row) => getMachineKey(row) === selectedMachineKey) || sortedRows[0] || null;
  const selectedRuns = useMemo(() => selectedRow ? jobRuns.filter((run) => matchesMachine(run, selectedRow)) : [], [jobRuns, selectedRow]);
  const activeRun = selectedRuns.find((run) => ACTIVE_RUN_STATUSES.has(String(run.status || "").toLowerCase())) || null;
  const selectedOrder = productionOrders.find((order) => String(order.id) === selectedOrderId) || null;

  useEffect(() => {
    if (!selectedOrder) return;
    const output = orderOutput(selectedOrder);
    setManualJobNumber(selectedOrder.production_number || "");
    setManualItemCode(output?.material_code || selectedOrder.title || "");
    setPlannedQuantity(String(output?.output_quantity || 0));
  }, [selectedOrder]);

  const resolvedDowntimeReasons = useMemo(() => SCHERDEL_DOWNTIME_REASONS.map((reason) => {
    const stored = downtimeReasons.find((row) => String(row.code) === reason.code);
    return { ...reason, id: stored?.id || null, category: stored?.category || "unplanned", isPlanned: Boolean(stored?.is_planned) };
  }), [downtimeReasons]);

  const faultStateByMachine = useMemo(() => new Map(sortedRows.map((row) => [
    getMachineKey(row),
    getMesMachineFaultState(mesEvents.filter((event) => matchesMachine(event, row)))
  ])), [mesEvents, sortedRows]);

  const resolveMachineStatus = useCallback((row) => {
    if (faultStateByMachine.get(getMachineKey(row))) {
      return { key: "fault", label: "Porucha" };
    }
    return machineStatus(row);
  }, [faultStateByMachine]);

  const summary = useMemo(() => sortedRows.reduce((result, row) => {
    const status = resolveMachineStatus(row).key;
    result.total += 1;
    result.running += status === "running" ? 1 : 0;
    result.fault += status === "fault" ? 1 : 0;
    result.downtime += status === "downtime" ? 1 : 0;
    result.setup += status === "setup" ? 1 : 0;
    result.good += Number(row.good_quantity || 0);
    result.scrap += Number(row.scrap_quantity || 0);
    return result;
  }, { total: 0, running: 0, fault: 0, downtime: 0, setup: 0, good: 0, scrap: 0 }), [resolveMachineStatus, sortedRows]);

  const calculatedOeeRange = useMemo(
    () => getMesAnalyticsRangeWindow(oeeRangeKey, oeeCustomStart, oeeCustomEnd),
    [oeeRangeKey, oeeCustomStart, oeeCustomEnd]
  );
  const activeOeeRange = oeeReport.rangeWindow || calculatedOeeRange;
  const handleOeeReportChange = useCallback((report) => setOeeReport(report), []);
  const selectedProductionDate = useMemo(
    () => toDateInputValue(new Date(calculatedOeeRange.startMs)),
    [calculatedOeeRange.startMs]
  );
  const today = toDateInputValue(new Date());
  const showProductionDaySwitcher = ["today", "yesterday", "selected_day"].includes(oeeRangeKey);

  const changeProductionDay = useCallback((dayOffset) => {
    const date = new Date(`${selectedProductionDate}T12:00:00`);
    date.setDate(date.getDate() + dayOffset);
    const nextDate = toDateInputValue(date);
    if (nextDate > toDateInputValue(new Date())) return;
    setOeeCustomStart(nextDate);
    setOeeCustomEnd(nextDate);
    setOeeRangeKey(nextDate === toDateInputValue(new Date()) ? "today" : "selected_day");
  }, [selectedProductionDate]);

  const oee = useMemo(() => {
    const rows = oeeReport.rows || [];
    const workstationById = new Map(workstations.map((row) => [String(row.id || ""), row]));
    const runtimeMinutes = Math.max(0, Number(oeeReport.runtimeMinutes || rows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.runtime_minutes || 0)), 0
    )));
    const pieces = rows.reduce((sum, row) => sum + Math.max(0, Number(row.pieces || 0)), 0);
    const availableMinutes = Math.max(0, (activeOeeRange.endMs - activeOeeRange.startMs) / 60_000) * Math.max(1, sortedRows.length);
    const theoreticalPieces = rows.reduce((sum, row) => {
      const workstation = workstationById.get(String(row.workstation_id || ""));
      return sum + Math.max(0, Number(workstation?.ideal_units_per_hour || 0)) * (Math.max(0, Number(row.runtime_minutes || 0)) / 60);
    }, 0);
    const good = Math.max(0, Number(oeeReport.quality?.good || 0));
    const scrap = Math.max(0, Number(oeeReport.quality?.scrap || 0));
    const qualityPieces = good + scrap;
    const availability = availableMinutes > 0 ? Math.min(100, runtimeMinutes / availableMinutes * 100) : 0;
    const performance = theoreticalPieces > 0 ? Math.min(100, pieces / theoreticalPieces * 100) : 0;
    const quality = qualityPieces > 0 ? good / qualityPieces * 100 : 0;
    return {
      availability,
      performance,
      quality,
      value: availability * performance * quality / 10_000,
      runtimeMinutes,
      pieces
    };
  }, [activeOeeRange.endMs, activeOeeRange.startMs, oeeReport.quality, oeeReport.rows, oeeReport.runtimeMinutes, sortedRows.length, workstations]);

  const shiftResults = useMemo(() => {
    const workstationById = new Map(workstations.map((row) => [String(row.id || ""), row]));
    const machineCount = Math.max(1, sortedRows.length);
    return SCHERDEL_SHIFTS.map((shift) => {
      const rows = (oeeReport.rows || []).filter((row) => Number(row.shift_order) === shift.order);
      const runtimeMinutes = rows.reduce((sum, row) => sum + Math.max(0, Number(row.runtime_minutes || 0)), 0);
      const pieces = rows.reduce((sum, row) => sum + Math.max(0, Number(row.pieces || 0)), 0);
      const shiftMinutes = getShiftWindowMinutes(activeOeeRange, shift) * machineCount;
      const availability = shiftMinutes > 0 ? Math.min(100, runtimeMinutes / shiftMinutes * 100) : 0;
      const downtimeMinutes = Math.max(0, shiftMinutes - runtimeMinutes);
      const unitsPerHour = runtimeMinutes > 0 ? pieces / (runtimeMinutes / 60) : 0;
      const theoreticalPieces = rows.reduce((sum, row) => {
        const workstation = workstationById.get(String(row.workstation_id || ""));
        return sum + Math.max(0, Number(workstation?.ideal_units_per_hour || 0)) * (Math.max(0, Number(row.runtime_minutes || 0)) / 60);
      }, 0);
      const performance = theoreticalPieces > 0 ? Math.min(100, pieces / theoreticalPieces * 100) : null;
      return { ...shift, rows, runtimeMinutes, pieces, availability, downtimeMinutes, unitsPerHour, performance };
    });
  }, [activeOeeRange, oeeReport.rows, sortedRows.length, workstations]);

  const showMessage = (tone, text) => setMessage({ tone, text });

  const writeEvent = async (run, eventType, options = {}) => {
    const payload = {
      job_run_id: run.id,
      company_id: accessContext.company.id,
      workstation_id: run.workstation_id,
      machine_id: run.machine_id || null,
      terminal_id: run.terminal_id || null,
      downtime_reason_id: options.downtimeReasonId || null,
      operator_user_id: accessContext.profile.user_id,
      operator_name: accessContext.profile.username || accessContext.profile.email || "",
      event_type: eventType,
      quantity: Number(options.quantity || 0),
      source: "web",
      note: options.note || "",
      payload: options.payload || {},
      happened_at: new Date().toISOString(),
      created_by: accessContext.profile.user_id
    };
    const { error } = await supabase.from("mes_job_run_events").insert(payload);
    if (!error) return;
    if (!isMissingMesEventColumnError(error)) throw error;

    const legacyPayload = {
      job_run_id: payload.job_run_id,
      workstation_id: payload.workstation_id,
      machine_id: payload.machine_id,
      downtime_reason_id: payload.downtime_reason_id,
      event_type: payload.event_type,
      quantity: payload.quantity,
      source: payload.source,
      note: payload.note,
      payload: {
        ...payload.payload,
        operator_name: payload.operator_name,
        operator_user_id: payload.operator_user_id,
        terminal_id: payload.terminal_id
      },
      happened_at: payload.happened_at,
      created_by: payload.created_by
    };
    const { error: legacyError } = await supabase.from("mes_job_run_events").insert(legacyPayload);
    if (legacyError) throw legacyError;
  };

  const updateMachineState = async (machineId, state) => {
    if (!machineId) return;
    const { error } = await supabase.from("mes_machines").update({
      machine_state: state,
      updated_by: accessContext.profile.user_id,
      updated_at: new Date().toISOString()
    }).eq("id", machineId);
    if (error) throw error;
  };

  const runAction = async (action, successText) => {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await action();
      showMessage("success", successText);
      await onRefresh();
    } catch (error) {
      showMessage("error", error?.message || "Operáciu sa nepodarilo uložiť.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateRun = () => runAction(async () => {
    if (!selectedRow?.workstation_id) throw new Error("Vyber pracovisko alebo stroj.");
    if (activeRun) throw new Error("Na tomto stroji už existuje aktívna zákazka.");
    if (!manualJobNumber.trim()) throw new Error("Zadaj číslo výrobnej zákazky.");
    const quantity = Math.max(0, Number.parseInt(plannedQuantity, 10) || 0);
    const now = new Date().toISOString();
    const { data: run, error } = await supabase.from("mes_job_runs").insert({
      company_id: accessContext.company.id,
      production_order_id: selectedOrder?.id || null,
      workstation_id: selectedRow.workstation_id,
      machine_id: selectedRow.machine_id || null,
      terminal_id: selectedRow.terminal_id || null,
      operator_user_id: accessContext.profile.user_id,
      operator_name: accessContext.profile.username || accessContext.profile.email || "",
      job_number: manualJobNumber.trim(),
      item_code: manualItemCode.trim(),
      item_name: selectedOrder?.title || manualItemCode.trim(),
      status: "queued",
      planned_quantity: quantity,
      setup_started_at: now,
      created_by: accessContext.profile.user_id,
      updated_by: accessContext.profile.user_id
    }).select("*").single();
    if (error) throw error;
    await writeEvent(run, "setup_start", { note: "Začiatok nastavenia / zmena zákazky" });
    await updateMachineState(run.machine_id, "setup");
  }, "Zákazka bola priradená. Prebieha nastavenie stroja.");

  const handleStartProduction = () => runAction(async () => {
    if (!activeRun) throw new Error("Nie je vybraná aktívna zákazka.");
    const now = new Date().toISOString();
    const { error } = await supabase.from("mes_job_runs").update({ status: "running", started_at: activeRun.started_at || now, updated_by: accessContext.profile.user_id }).eq("id", activeRun.id);
    if (error) throw error;
    await writeEvent(activeRun, activeRun.status === "queued" ? "setup_end" : "resume", { note: activeRun.status === "queued" ? "Ukončenie nastavenia" : "Pokračovanie výroby" });
    if (activeRun.status === "queued") await writeEvent(activeRun, "start", { note: "Spustenie automatického cyklu" });
    await updateMachineState(activeRun.machine_id, "running");
  }, "Výroba bola spustená.");

  const handlePause = () => runAction(async () => {
    if (!activeRun) throw new Error("Nie je vybraná aktívna zákazka.");
    const reason = resolvedDowntimeReasons.find((row) => row.code === downtimeCode);
    if (!reason) throw new Error("Pred prestojom vyber dôvod podľa štandardu C.E.P.");
    const { error } = await supabase.from("mes_job_runs").update({ status: "paused", updated_by: accessContext.profile.user_id }).eq("id", activeRun.id);
    if (error) throw error;
    await writeEvent(activeRun, "downtime_start", {
      downtimeReasonId: reason.id,
      note: `${reason.code} – ${reason.name}`,
      payload: { downtime_code: reason.code, downtime_name: reason.name, classified: true }
    });
    await updateMachineState(activeRun.machine_id, "down");
  }, "Prestoj bol zaevidovaný s povinným dôvodom.");

  const handleIncrement = (kind) => runAction(async () => {
    if (!activeRun) throw new Error("Nie je vybraná aktívna zákazka.");
    const quantity = Math.max(1, Number.parseInt(countQuantity, 10) || 1);
    if (kind === "scrap" && !defectCode) throw new Error("Pre NOK kusy vyber presný typ chyby.");
    const column = kind === "good" ? "good_quantity" : "scrap_quantity";
    const nextValue = Number(activeRun[column] || 0) + quantity;
    const { error } = await supabase.from("mes_job_runs").update({ [column]: nextValue, updated_by: accessContext.profile.user_id }).eq("id", activeRun.id);
    if (error) throw error;
    const defect = SCHERDEL_DEFECT_REASONS.find((row) => row.code === defectCode);
    await writeEvent(activeRun, kind === "good" ? "good_count" : "scrap_count", {
      quantity,
      note: defect ? `${defect.code} – ${defect.name}` : "i.O. kusy",
      payload: defect ? { defect_code: defect.code, defect_name: defect.name } : { quality: "i.O." }
    });
  }, kind === "good" ? "i.O. kusy boli pripočítané." : "n.i.O. kusy a typ chyby boli uložené.");

  const handleComplete = () => runAction(async () => {
    if (!activeRun) throw new Error("Nie je vybraná aktívna zákazka.");
    const now = new Date().toISOString();
    const { error } = await supabase.from("mes_job_runs").update({ status: "completed", ended_at: now, updated_by: accessContext.profile.user_id }).eq("id", activeRun.id);
    if (error) throw error;
    await writeEvent(activeRun, "complete", { note: `Ukončené: ${activeRun.good_quantity || 0} i.O., ${activeRun.scrap_quantity || 0} n.i.O.` });
    await updateMachineState(activeRun.machine_id, "idle");
  }, "Výrobná zákazka bola ukončená.");

  const handleActivity = () => runAction(async () => {
    const activity = [...SCHERDEL_MACHINE_ACTIVITIES, ...SCHERDEL_OVERHEAD_ACTIVITIES].find((row) => row.code === activityCode);
    if (!activity) throw new Error("Vyber režijnú činnosť.");
    const { error } = await supabase.from("mes_scherdel_activities").insert({
      company_id: accessContext.company.id,
      workstation_id: selectedRow?.workstation_id || null,
      machine_id: selectedRow?.machine_id || null,
      job_run_id: activeRun?.id || null,
      operator_user_id: accessContext.profile.user_id,
      operator_name: accessContext.profile.username || accessContext.profile.email || "",
      activity_code: activity.code,
      activity_name: activity.name,
      note: activityNote.trim(),
      started_at: new Date().toISOString(),
      created_by: accessContext.profile.user_id
    });
    if (error) throw error;
    setActivityNote("");
  }, "Režijná činnosť bola zaznamenaná.");

  const role = getProfileRole(accessContext.profile);
  const navigation = [
    ["live", Activity, "Živá výroba"], ["terminal", ScanLine, "Operátorský terminál"],
    ["oee", Gauge, "OEE a exporty"], ["catalogs", Tags, "Číselníky C.E.P."]
  ];

  return (
    <main className="scherdel-mes" style={{ "--scherdel-accent": tenant.branding?.accent || "#0067a8" }}>
      <header className="scherdel-topbar">
        <div className="scherdel-brand">
          <img className="scherdel-company-logo" src={tenant.branding?.companyLogo} alt="SCHERDEL" />
          <span aria-hidden="true" />
          <img className="scherdel-platform-logo" src={tenant.branding?.platformLogo} alt="MESLULA" />
          <small>Manufacturing Execution System</small>
        </div>
        <div className="scherdel-user"><span><ShieldCheck size={15} />{SCHERDEL_ROLE_LABELS[role] || role}</span><div><strong>{accessContext.profile.username || accessContext.profile.email}</strong><small>{accessContext.company.name}</small></div><button type="button" onClick={onSignOut} aria-label="Odhlásiť"><LogOut size={18} /></button></div>
      </header>

      <section className="scherdel-hero">
        <div><p>Výrobný monitoring · C.E.P. Scherdel</p><h1>Riadenie a sledovanie výroby</h1><span>{lastLoadedAt ? `Aktualizované ${formatDateTime(lastLoadedAt)}` : "Načítavam aktuálny stav výroby"}</span></div>
        <button type="button" onClick={onRefresh} disabled={dataLoading}><RefreshCw className={dataLoading ? "mes-tenant-spinner" : ""} size={17} />{dataLoading ? "Obnovujem" : "Obnoviť dáta"}</button>
      </section>

      <nav className="scherdel-nav" aria-label="Scherdel MES navigácia">
        {navigation.map(([key, Icon, label]) => <button type="button" key={key} className={activeSection === key ? "active" : ""} onClick={() => setActiveSection(key)}><Icon size={17} />{label}</button>)}
      </nav>

      {dataError ? <p className="scherdel-alert error"><AlertTriangle size={17} />{dataError}</p> : null}
      {message ? <p className={`scherdel-alert ${message.tone}`}><CheckCircle2 size={17} />{message.text}</p> : null}

      {activeSection === "live" ? <>
        <ScherdelFactoryMap
          rows={sortedRows}
          selectedMachineKey={selectedMachineKey}
          onSelectMachine={setSelectedMachineKey}
          onOpenTerminal={() => setActiveSection("terminal")}
          resolveStatus={resolveMachineStatus}
          companyId={accessContext.company.id}
          userId={accessContext.profile.user_id}
          onRefresh={onRefresh}
        />
        <section className="scherdel-kpis">
          <article><Factory /><span>Stroje</span><strong>{formatNumber(summary.total)}</strong></article>
          <article className="running"><PlayCircle /><span>Automatický cyklus</span><strong>{formatNumber(summary.running)}</strong></article>
          <article className="fault"><AlertTriangle /><span>Poruchy</span><strong>{formatNumber(summary.fault)}</strong></article>
          <article className="setup"><Settings2 /><span>Nastavenie</span><strong>{formatNumber(summary.setup)}</strong></article>
          <article className="down"><Clock3 /><span>Prestoje</span><strong>{formatNumber(summary.downtime)}</strong></article>
          <article><PackageCheck /><span>i.O. / n.i.O.</span><strong>{formatNumber(summary.good)} / {formatNumber(summary.scrap)}</strong></article>
        </section>
        <section className="scherdel-machine-grid">
          {sortedRows.map((row) => {
            const status = resolveMachineStatus(row);
            const completion = Number(row.planned_quantity || 0) > 0 ? Math.min(100, Number(row.good_quantity || 0) / Number(row.planned_quantity) * 100) : 0;
            const requiresReason = status.key === "downtime" && !row.current_downtime_reason;
            return <button type="button" className={`scherdel-machine-card ${status.key} ${getMachineKey(row) === selectedMachineKey ? "selected" : ""}`} key={getMachineKey(row)} onClick={() => setSelectedMachineKey(getMachineKey(row))}>
              <div className="scherdel-machine-head"><span>{row.workstation_code || "Pracovisko"}</span><b className={`state ${status.key}`}>{status.label}</b></div>
              <h2>{row.machine_name || row.workstation_name}</h2>
              <dl><div><dt>Zákazka</dt><dd>{row.job_number || "Bez aktívnej zákazky"}</dd></div><div><dt>Výrobok / ID Nr.</dt><dd>{row.item_code || row.item_name || "–"}</dd></div><div><dt>Operátor</dt><dd>{row.operator_name || "–"}</dd></div><div><dt>Plán</dt><dd>{formatNumber(row.good_quantity)} / {formatNumber(row.planned_quantity)} ks</dd></div></dl>
              <div className="scherdel-progress"><span style={{ width: `${completion}%` }} /></div>
              {row.current_downtime_reason ? <p className="reason"><Clock3 size={14} />{row.current_downtime_reason}</p> : null}
              {requiresReason ? <p className="reason required"><AlertTriangle size={14} />Prestoj vyžaduje klasifikáciu pred pokračovaním</p> : null}
            </button>;
          })}
          {!dataLoading && !sortedRows.length ? <p className="scherdel-empty">Pre Scherdel zatiaľ nie sú založené MES pracoviská.</p> : null}
        </section>
      </> : null}

      {activeSection === "terminal" ? <section className="scherdel-terminal-layout">
        <aside className="scherdel-terminal-side">
          <div className="scherdel-section-title"><ScanLine /><div><span>RFID relácia</span><h2>Identifikácia obsluhy</h2></div></div>
          <div className="scherdel-rfid"><UserRound /><div><strong>{accessContext.profile.username || accessContext.profile.email}</strong><span>{SCHERDEL_ROLE_LABELS[role] || role}</span></div><b>Autorizované</b></div>
          <label><span>Stroj / pracovisko</span><select value={selectedMachineKey} onChange={(event) => setSelectedMachineKey(event.target.value)}>{sortedRows.map((row) => <option key={getMachineKey(row)} value={getMachineKey(row)}>{row.machine_name || row.workstation_name}</option>)}</select></label>
          <div className="scherdel-selected-state"><span>Aktuálny stav</span><strong className={resolveMachineStatus(selectedRow).key}>{resolveMachineStatus(selectedRow).label}</strong><small>{selectedRow?.machine_name || selectedRow?.workstation_name || "Nie je vybraný stroj"}</small></div>
        </aside>

        <div className="scherdel-terminal-main">
          {!activeRun ? <article className="scherdel-panel">
            <div className="scherdel-section-title"><ClipboardList /><div><span>Výrobný plán</span><h2>Priradiť výrobnú zákazku</h2></div></div>
            <div className="scherdel-form-grid">
              <label className="wide"><span>Zákazka zo systému</span><select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}><option value="">Manuálne zadanie</option>{productionOrders.map((order) => <option key={order.id} value={order.id}>{order.production_number} · {order.title}</option>)}</select></label>
              <label><span>Číslo zákazky</span><input value={manualJobNumber} onChange={(event) => setManualJobNumber(event.target.value)} /></label>
              <label><span>ID Nr. výrobku</span><input value={manualItemCode} onChange={(event) => setManualItemCode(event.target.value)} /></label>
              <label><span>Plánovaný počet kusov</span><input type="number" min="0" value={plannedQuantity} onChange={(event) => setPlannedQuantity(event.target.value)} /></label>
            </div>
            <button className="scherdel-primary" type="button" onClick={handleCreateRun} disabled={submitting || !selectedRow}><Settings2 size={17} />Začať nastavenie / zmenu zákazky</button>
          </article> : <>
            <article className="scherdel-panel scherdel-active-order">
              <div className="scherdel-section-title"><Factory /><div><span>Aktívna zákazka</span><h2>{activeRun.job_number}</h2></div><b>{String(activeRun.status).toUpperCase()}</b></div>
              <div className="scherdel-order-facts"><div><span>ID Nr.</span><strong>{activeRun.item_code || "–"}</strong></div><div><span>Plán</span><strong>{formatNumber(activeRun.planned_quantity)} ks</strong></div><div><span>i.O.</span><strong>{formatNumber(activeRun.good_quantity)}</strong></div><div><span>n.i.O.</span><strong>{formatNumber(activeRun.scrap_quantity)}</strong></div></div>
              <div className="scherdel-action-row">
                {activeRun.status !== "running" ? <button className="scherdel-primary" type="button" onClick={handleStartProduction} disabled={submitting}><PlayCircle />{activeRun.status === "queued" ? "Ukončiť nastavenie a spustiť" : "Pokračovať vo výrobe"}</button> : <button className="scherdel-warning" type="button" onClick={handlePause} disabled={submitting || !downtimeCode}><PauseCircle />Zaevidovať prestoj</button>}
                <button className="scherdel-danger" type="button" onClick={handleComplete} disabled={submitting}><Square />Ukončiť zákazku</button>
              </div>
            </article>

            <div className="scherdel-two-columns">
              <article className="scherdel-panel"><div className="scherdel-section-title"><PackageCheck /><div><span>Kvalita</span><h2>Zápis kusov</h2></div></div><label><span>Počet kusov</span><input type="number" min="1" value={countQuantity} onChange={(event) => setCountQuantity(event.target.value)} /></label><label><span>Typ chyby pre n.i.O.</span><select value={defectCode} onChange={(event) => setDefectCode(event.target.value)}><option value="">Vybrať chybu A–W</option>{SCHERDEL_DEFECT_REASONS.map((reason) => <option key={reason.code} value={reason.code}>{reason.code} · {reason.name}</option>)}</select></label><div className="scherdel-action-row"><button className="scherdel-success" type="button" onClick={() => handleIncrement("good")} disabled={submitting}><CheckCircle2 />Pridať i.O.</button><button className="scherdel-danger" type="button" onClick={() => handleIncrement("scrap")} disabled={submitting || !defectCode}><AlertTriangle />Pridať n.i.O.</button></div></article>
              <article className="scherdel-panel"><div className="scherdel-section-title"><Clock3 /><div><span>Povinné pri prestoji</span><h2>Dôvod prestoja C.E.P.</h2></div></div><label><span>Kód 1–21 / 98 / 99</span><select value={downtimeCode} onChange={(event) => setDowntimeCode(event.target.value)}><option value="">Vybrať dôvod prestoja</option>{resolvedDowntimeReasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.code} · {reason.name}</option>)}</select></label><p className="scherdel-note"><AlertTriangle size={15} />Po prestoji dlhšom ako 1 minúta systém nepovolí pokračovať bez klasifikácie.</p></article>
            </div>
          </>}

          <article className="scherdel-panel">
            <div className="scherdel-section-title"><Wrench /><div><span>Plánované a neplánované činnosti</span><h2>Režijná činnosť</h2></div></div>
            <div className="scherdel-form-grid"><label className="wide"><span>Kód činnosti</span><select value={activityCode} onChange={(event) => setActivityCode(event.target.value)}><option value="">Vybrať režijnú činnosť</option><optgroup label="Činnosti pri stroji">{SCHERDEL_MACHINE_ACTIVITIES.map((row) => <option key={row.code} value={row.code}>{row.code} · {row.name}</option>)}</optgroup><optgroup label="Činnosti mimo stroja">{SCHERDEL_OVERHEAD_ACTIVITIES.map((row) => <option key={row.code} value={row.code}>{row.code} · {row.name}</option>)}</optgroup></select></label><label className="wide"><span>Poznámka</span><input value={activityNote} onChange={(event) => setActivityNote(event.target.value)} placeholder="Voliteľná poznámka" /></label></div>
            <button className="scherdel-secondary" type="button" onClick={handleActivity} disabled={submitting || !activityCode}><Wrench size={17} />Zaznamenať činnosť</button>
          </article>
        </div>
      </section> : null}

      {activeSection === "oee" ? <section className="scherdel-oee">
        <div className="scherdel-oee-head"><div><p>OEE · plán × realita</p><h2>Výkon výrobných zariadení</h2></div><strong>{formatNumber(oee.value)} %</strong></div>
        <div className={`scherdel-oee-period ${oeeRangeKey === "selected_day" ? "single-day" : ""}`}>
          <label><span>Obdobie</span><select value={oeeRangeKey} onChange={(event) => setOeeRangeKey(event.target.value)}><option value="current_shift">Aktuálna zmena</option><option value="today">Dnes</option><option value="yesterday">Včera</option><option value="selected_day">Vybraný deň</option><option value="last_7_days">Posledných 7 dní</option><option value="custom">Vlastné obdobie</option></select></label>
          {oeeRangeKey === "selected_day" ? <label><span>Výrobný deň</span><input type="date" value={oeeCustomStart} max={today} onChange={(event) => { setOeeCustomStart(event.target.value); setOeeCustomEnd(event.target.value); }} /></label> : null}
          {oeeRangeKey === "custom" ? <><label><span>Dátum od</span><input type="date" value={oeeCustomStart} onChange={(event) => setOeeCustomStart(event.target.value)} /></label><label><span>Dátum do</span><input type="date" value={oeeCustomEnd} onChange={(event) => setOeeCustomEnd(event.target.value)} /></label></> : null}
          <div><span>Rozsah výpočtu</span><strong>{calculatedOeeRange.label}</strong></div>
        </div>
        {showProductionDaySwitcher ? <div className="scherdel-oee-day-switcher" aria-label="Prepnúť výrobný deň">
          <button type="button" onClick={() => changeProductionDay(-1)} aria-label="Predchádzajúci výrobný deň"><ChevronLeft size={19} /></button>
          <div><span>Výrobný deň</span><strong>{new Date(`${selectedProductionDate}T12:00:00`).toLocaleDateString("sk-SK", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}</strong></div>
          <button type="button" onClick={() => changeProductionDay(1)} disabled={selectedProductionDate >= today} aria-label="Nasledujúci výrobný deň"><ChevronRight size={19} /></button>
        </div> : null}
        <div className={`scherdel-oee-formula ${oeeReport.loading ? "loading" : ""}`} aria-busy={oeeReport.loading}>
          <article><Clock3 /><span>A · Dostupnosť</span><strong>{formatNumber(oee.availability)} %</strong></article><i>×</i>
          <article><BarChart3 /><span>P · Výkonnosť</span><strong>{formatNumber(oee.performance)} %</strong></article><i>×</i>
          <article><CheckCircle2 /><span>Q · Kvalita</span><strong>{formatNumber(oee.quality)} %</strong></article><i>=</i>
          <article className="result"><Gauge /><span>OEE</span><strong>{formatNumber(oee.value)} %</strong></article>
        </div>
        <div className="scherdel-shifts">
          <div className="scherdel-shifts-head"><div><span>Zvolené obdobie</span><h3>Produktivita podľa zmien</h3></div><small>{oeeReport.loading ? "Načítavam výrobné dáta…" : activeOeeRange.label}</small></div>
          {oeeReport.error ? <div className="scherdel-shifts-error"><AlertTriangle size={16} />{oeeReport.error}</div> : null}
          <div className="scherdel-shifts-grid">
            {shiftResults.map((shift) => <article className={`scherdel-shift-card ${shift.key}`} key={shift.key}>
              <header><div><span>{shift.name}</span><strong>{shift.time}</strong></div></header>
              <p>Súhrn za vybrané obdobie</p>
              <div className="scherdel-shift-primary"><span>Produktivita</span><strong>{formatNumber(shift.unitsPerHour)} <small>ks/h</small></strong><em>{formatNumber(shift.pieces)} vyrobených kusov</em></div>
              <dl>
                <div><dt>Výrobný čas</dt><dd>{formatNumber(shift.runtimeMinutes)} min</dd></div>
                <div><dt>Prestoj</dt><dd>{formatNumber(shift.downtimeMinutes)} min</dd></div>
                <div><dt>Dostupnosť</dt><dd>{formatNumber(shift.availability)} %</dd></div>
                <div><dt>Výkon voči norme</dt><dd>{shift.performance == null ? "Bez normy" : `${formatNumber(shift.performance)} %`}</dd></div>
              </dl>
              <div className="scherdel-shift-progress" aria-label={`Dostupnosť ${formatNumber(shift.availability)} percent`}><span style={{ width: `${Math.max(0, Math.min(100, shift.availability))}%` }} /></div>
              {!oeeReport.loading && !shift.rows.length ? <small className="scherdel-shift-empty">V tejto zmene nie sú výrobné udalosti.</small> : null}
            </article>)}
          </div>
        </div>
        <MesAnalyticsExports
          companyId={accessContext.company.id}
          companyName={accessContext.company.name}
          overviewRows={overviewRows}
          workstations={workstations}
          rangeKey={oeeRangeKey}
          onRangeKeyChange={setOeeRangeKey}
          customStart={oeeCustomStart}
          onCustomStartChange={setOeeCustomStart}
          customEnd={oeeCustomEnd}
          onCustomEndChange={setOeeCustomEnd}
          onReportChange={handleOeeReportChange}
        />
      </section> : null}

      {activeSection === "catalogs" ? <section className="scherdel-catalogs">
        <article><div className="scherdel-section-title"><AlertTriangle /><div><span>Kvalita</span><h2>Chyby výrobku</h2></div></div><div className="scherdel-code-list">{SCHERDEL_DEFECT_REASONS.map((row) => <div key={row.code}><b>{row.code}</b><span>{row.name}</span></div>)}</div></article>
        <article><div className="scherdel-section-title"><Clock3 /><div><span>Dostupnosť</span><h2>Prestoje</h2></div></div><div className="scherdel-code-list">{resolvedDowntimeReasons.map((row) => <div key={row.code}><b>{row.code}</b><span>{row.name}</span></div>)}</div></article>
        <article><div className="scherdel-section-title"><Wrench /><div><span>Výkonové listy</span><h2>Režijné činnosti</h2></div></div><div className="scherdel-code-list">{[...SCHERDEL_MACHINE_ACTIVITIES, ...SCHERDEL_OVERHEAD_ACTIVITIES].map((row) => <div key={row.code}><b>{row.code}</b><span>{row.name}</span></div>)}</div></article>
      </section> : null}
    </main>
  );
}
