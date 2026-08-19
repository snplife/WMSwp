import { useEffect, useMemo, useState } from "react";
import { Factory, FileSpreadsheet, LayoutDashboard, LogOut, RefreshCw } from "lucide-react";
import { supabase } from "../../supabaseClient";
import MesAnalyticsExports from "./MesAnalyticsExports";
import MesCharts from "./MesCharts";
import "./factoryOsMesDashboard.css";
import "./mlProduktionBrand.css";

const formatNumber = (value) => new Intl.NumberFormat("sk-SK").format(Number(value || 0));

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getRowKey(row) {
  return String(row?.machine_id || row?.workstation_id || "");
}

function getTileState(row) {
  const status = String(row.machine_state || row.job_status || "").toLowerCase();
  if (status === "running") {
    return { label: "Beží", className: "mes-machine-status-tile-running" };
  }
  if (row.current_downtime_reason || status === "paused" || status === "downtime") {
    return { label: "Stojí s dôvodom", className: "mes-machine-status-tile-warning" };
  }
  return { label: "Stojí bez dôvodu", className: "mes-machine-status-tile-danger" };
}

function matchesSelectedMachine(run, row) {
  const machineId = String(row?.machine_id || "");
  const workstationId = String(row?.workstation_id || "");
  return (
    (machineId && String(run.machine_id || "") === machineId) ||
    (workstationId && String(run.workstation_id || "") === workstationId) ||
    (row?.job_run_id && String(run.id || "") === String(row.job_run_id))
  );
}

function normalizeRegistrationCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function buildDeviceCode(value) {
  const name = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
  return `MES-${name || "DEVICE"}-${Date.now().toString(36).toUpperCase()}`.slice(0, 48);
}

export default function FactoryOsMesDashboard({
  tenant,
  accessContext,
  overviewRows,
  jobRuns,
  mesEvents,
  workstations,
  dataLoading,
  dataError,
  lastLoadedAt,
  onRefresh,
  onSignOut
}) {
  const [selectedMachineKey, setSelectedMachineKey] = useState("");
  const [activeSection, setActiveSection] = useState("dashboard");
  const [isDeviceAdminOpen, setIsDeviceAdminOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameTerminalName, setRenameTerminalName] = useState("");
  const [renameTerminalCode, setRenameTerminalCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newTerminalName, setNewTerminalName] = useState("");
  const [newTerminalCode, setNewTerminalCode] = useState("");
  const [newArea, setNewArea] = useState("");
  const [deviceSubmitting, setDeviceSubmitting] = useState(false);
  const [deviceMessage, setDeviceMessage] = useState("");
  const sortedRows = useMemo(
    () => [...overviewRows].sort((left, right) =>
      String(left.machine_name || left.workstation_name || "").localeCompare(
        String(right.machine_name || right.workstation_name || ""),
        "sk-SK",
        { sensitivity: "base" }
      )
    ),
    [overviewRows]
  );

  useEffect(() => {
    if (!sortedRows.some((row) => getRowKey(row) === selectedMachineKey)) {
      setSelectedMachineKey(getRowKey(sortedRows[0]));
    }
  }, [selectedMachineKey, sortedRows]);

  const selectedRow = sortedRows.find((row) => getRowKey(row) === selectedMachineKey) || sortedRows[0] || null;
  const selectedRuns = useMemo(
    () => selectedRow ? jobRuns.filter((run) => matchesSelectedMachine(run, selectedRow)) : [],
    [jobRuns, selectedRow]
  );
  const activeRun = selectedRuns.find((run) => ["queued", "running", "paused"].includes(String(run.status || "").toLowerCase())) || selectedRuns[0] || null;
  const completedRuns = selectedRuns.filter((run) => ["completed", "complete", "done", "finished"].includes(String(run.status || "").toLowerCase()));
  const selectedGood = selectedRuns.reduce((sum, run) => sum + Number(run.good_quantity || 0), 0);
  const selectedScrap = selectedRuns.reduce((sum, run) => sum + Number(run.scrap_quantity || 0), 0);

  useEffect(() => {
    setRenameName(selectedRow?.machine_name || selectedRow?.workstation_name || "");
    setRenameTerminalName(selectedRow?.terminal_name || "");
    setRenameTerminalCode(selectedRow?.terminal_code || "");
    setDeviceMessage("");
  }, [selectedRow?.machine_id, selectedRow?.workstation_id, selectedRow?.terminal_id]);

  const handleRenameDevice = async () => {
    if (!selectedRow) {
      setDeviceMessage("Najprv vyber zariadenie.");
      return;
    }
    const companyId = accessContext.company.id;
    const userId = accessContext.profile.user_id;
    const now = new Date().toISOString();
    const terminalCode = normalizeRegistrationCode(renameTerminalCode);
    setDeviceSubmitting(true);
    setDeviceMessage("");
    try {
      if (renameName.trim() && selectedRow.machine_id) {
        const { error } = await supabase.from("mes_machines").update({ name: renameName.trim(), updated_by: userId, updated_at: now }).eq("id", selectedRow.machine_id).eq("workstation_id", selectedRow.workstation_id);
        if (error) throw error;
      } else if (renameName.trim() && selectedRow.workstation_id) {
        const { error } = await supabase.from("mes_workstations").update({ name: renameName.trim(), updated_by: userId, updated_at: now }).eq("id", selectedRow.workstation_id).eq("company_id", companyId);
        if (error) throw error;
      }
      if ((renameTerminalName.trim() || terminalCode) && !selectedRow.terminal_id) {
        throw new Error("Vybrané zariadenie nemá priradený HMI terminál.");
      }
      if (selectedRow.terminal_id) {
        const terminalPayload = { updated_by: userId, updated_at: now };
        if (renameTerminalName.trim()) terminalPayload.name = renameTerminalName.trim();
        if (terminalCode) terminalPayload.terminal_code = terminalCode;
        const { error } = await supabase.from("mes_hmi_terminals").update(terminalPayload).eq("id", selectedRow.terminal_id).eq("company_id", companyId);
        if (error) throw error;
      }
      setDeviceMessage("Zariadenie bolo uložené.");
      await onRefresh();
    } catch (error) {
      setDeviceMessage(error?.message || "Zariadenie sa nepodarilo uložiť.");
    } finally {
      setDeviceSubmitting(false);
    }
  };

  const handleCreateDevice = async () => {
    const name = newName.trim();
    const terminalCode = normalizeRegistrationCode(newTerminalCode);
    if (!name || !terminalCode) {
      setDeviceMessage("Zadaj názov zariadenia a registračný kód terminálu.");
      return;
    }
    const companyId = accessContext.company.id;
    const userId = accessContext.profile.user_id;
    const now = new Date().toISOString();
    const deviceCode = buildDeviceCode(name);
    setDeviceSubmitting(true);
    setDeviceMessage("");
    try {
      const { data: workstation, error: workstationError } = await supabase.from("mes_workstations").insert({ company_id: companyId, code: deviceCode, name, area: newArea.trim(), hmi_enabled: true, is_active: true, created_by: userId, updated_by: userId }).select("id").single();
      if (workstationError) throw workstationError;
      const { error: machineError } = await supabase.from("mes_machines").insert({ workstation_id: workstation.id, code: deviceCode, name, machine_state: "idle", is_active: true, created_by: userId, updated_by: userId });
      if (machineError) throw machineError;

      const { data: existingTerminal, error: lookupError } = await supabase.from("mes_hmi_terminals").select("id").eq("company_id", companyId).eq("terminal_code", terminalCode).maybeSingle();
      if (lookupError) throw lookupError;
      const terminalPayload = { workstation_id: workstation.id, terminal_code: terminalCode, name: newTerminalName.trim() || name, platform: "web_kiosk", app_mode: "hmi", is_active: true, updated_by: userId, updated_at: now };
      if (existingTerminal?.id) {
        const { error } = await supabase.from("mes_hmi_terminals").update(terminalPayload).eq("id", existingTerminal.id).eq("company_id", companyId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("mes_hmi_terminals").insert({ ...terminalPayload, company_id: companyId, created_by: userId });
        if (error) throw error;
      }
      setNewName("");
      setNewTerminalName("");
      setNewTerminalCode("");
      setNewArea("");
      setDeviceMessage("Nové zariadenie bolo pridané.");
      await onRefresh();
    } catch (error) {
      setDeviceMessage(error?.message || "Zariadenie sa nepodarilo pridať.");
    } finally {
      setDeviceSubmitting(false);
    }
  };

  return (
    <main className="factory-os-mes-tenant">
      <header className="factory-os-mes-topbar">
        <div className={`factory-os-mes-brand${tenant.branding?.companyLogo ? " factory-os-mes-brand-logo" : ""}`}>
          {tenant.branding?.companyLogo
            ? <img className="factory-os-mes-company-logo" src={tenant.branding.companyLogo} alt={tenant.branding.companyName || tenant.branding.productName || "Firemné logo"} />
            : <span><Factory size={22} /></span>}
          <div><strong>Factory OS</strong><p>{tenant.branding?.productName || "MES"}</p></div>
        </div>
        <div className="factory-os-mes-user">
          <div><strong>{accessContext.profile.username || accessContext.profile.email}</strong><span>{accessContext.company.name}</span></div>
          <button type="button" onClick={onSignOut} aria-label="Odhlásiť"><LogOut size={17} /></button>
        </div>
      </header>

      <section className="factory-os-mes-hero">
        <div><p className="workflow-section-kicker">Manufacturing</p><h1>{activeSection === "dashboard" ? "MES dashboard" : "Analytika a exporty"}</h1><p>{activeSection === "dashboard" ? "Prehľad strojov, výrobných zákaziek a aktuálneho stavu prevádzky." : "Reporty výroby pripravené na náhľad a export do Excelu."}</p></div>
        <div className="hero-badges"><span className="table-badge">MES používateľ</span><span className="table-badge">{accessContext.company.name}</span></div>
      </section>

      <nav className="factory-os-mes-navigation" aria-label="Navigácia MES">
        <button type="button" className={activeSection === "dashboard" ? "is-active" : ""} onClick={() => setActiveSection("dashboard")}><LayoutDashboard size={17} />Dashboard</button>
        <button type="button" className={activeSection === "analytics" ? "is-active" : ""} onClick={() => setActiveSection("analytics")}><FileSpreadsheet size={17} />Analytika a exporty</button>
      </nav>

      {activeSection === "dashboard" ? <>
      <article className="orders-panel-card workflow-card workflow-card-list mes-dashboard-card factory-os-mes-panel">
        <div className="panel-head workflow-section-head">
          <div><p className="workflow-section-kicker">MES</p><h2>Nový MES dashboard</h2><p className="panel-meta">Dostupné MES terminály a stroje podľa aktuálneho stavu.</p></div>
          <div className="hero-badges">
            {dataLoading && <span className="table-badge">načítavam dáta</span>}
            <button type="button" className="settings-btn mes-refresh-button" onClick={onRefresh} disabled={dataLoading}><RefreshCw size={15} className={dataLoading ? "mes-tenant-spinner" : ""} />{dataLoading ? "Obnovujem" : "Obnoviť dáta"}</button>
          </div>
        </div>

        {dataError && <p className="error">{dataError}</p>}
        {!dataLoading && sortedRows.length === 0 ? (
          <p className="hint">Pre túto firmu zatiaľ nie sú dostupné žiadne MES terminály alebo stroje.</p>
        ) : (
          <>
            <section className="mes-device-admin-card">
              <div className="mes-device-admin-head">
                <div><span className="workflow-section-kicker">Zariadenia</span><h3>Správa MES zariadení</h3><p>Oprav názov vybraného zariadenia alebo pridaj nový stroj s HMI terminálom.</p></div>
                <div className="hero-badges">{deviceMessage && <span className="table-badge">{deviceMessage}</span>}<button type="button" className="settings-btn" onClick={() => setIsDeviceAdminOpen((value) => !value)}>{isDeviceAdminOpen ? "Skryť" : "Otvoriť"}</button></div>
              </div>
              {isDeviceAdminOpen && (
                <div className="mes-device-admin-grid">
                  <article className="mes-device-admin-form">
                    <strong>Premenovať vybrané</strong>
                    <label className="workflow-field"><span className="workflow-field-label">Názov zariadenia</span><input value={renameName} onChange={(event) => setRenameName(event.target.value)} /></label>
                    <label className="workflow-field"><span className="workflow-field-label">Názov terminálu</span><input value={renameTerminalName} onChange={(event) => setRenameTerminalName(event.target.value)} /></label>
                    <label className="workflow-field"><span className="workflow-field-label">Registračný kód terminálu</span><input value={renameTerminalCode} onChange={(event) => setRenameTerminalCode(event.target.value)} /></label>
                    <button type="button" className="settings-btn" onClick={handleRenameDevice} disabled={deviceSubmitting || !selectedRow}>{deviceSubmitting ? "Ukladám..." : "Uložiť zariadenie"}</button>
                  </article>
                  <article className="mes-device-admin-form">
                    <strong>Pridať nové</strong>
                    <label className="workflow-field"><span className="workflow-field-label">Názov zariadenia</span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Napr. Lis 01" /></label>
                    <label className="workflow-field"><span className="workflow-field-label">Názov terminálu</span><input value={newTerminalName} onChange={(event) => setNewTerminalName(event.target.value)} placeholder="Voliteľné" /></label>
                    <label className="workflow-field"><span className="workflow-field-label">Registračný kód terminálu</span><input value={newTerminalCode} onChange={(event) => setNewTerminalCode(event.target.value)} placeholder="P4-AABBCCDDEEFF" /></label>
                    <label className="workflow-field"><span className="workflow-field-label">Oblasť / hala</span><input value={newArea} onChange={(event) => setNewArea(event.target.value)} /></label>
                    <button type="button" className="settings-btn" onClick={handleCreateDevice} disabled={deviceSubmitting}>{deviceSubmitting ? "Ukladám..." : "Pridať zariadenie"}</button>
                  </article>
                </div>
              )}
            </section>

            <section className="mes-machine-status-panel" aria-label="Dostupné MES terminály">
              {sortedRows.map((row) => {
                const tileState = getTileState(row);
                const rowKey = getRowKey(row);
                return (
                  <button key={rowKey} type="button" className={`mes-machine-status-tile ${tileState.className} ${rowKey === selectedMachineKey ? "is-selected" : ""}`} onClick={() => setSelectedMachineKey(rowKey)}>
                    <span className="mes-machine-status-label">{tileState.label}</span>
                    <strong>{row.machine_name || row.workstation_name || row.machine_code || "Stroj"}</strong>
                    <span>{row.terminal_name || row.workstation_name || "Terminál nie je evidovaný"}</span>
                    <small>{row.current_downtime_reason || row.job_number || row.machine_state || "Bez aktívnej zákazky"}</small>
                  </button>
                );
              })}
            </section>

            {selectedRow && (
              <section className="mes-selected-machine-card" aria-label="Detail rozkliknutého stroja">
                <div className="mes-selected-machine-head">
                  <div><span className="workflow-section-kicker">Rozkliknutý stroj</span><h3>{selectedRow.machine_name || selectedRow.workstation_name || "Stroj"}</h3><p>{selectedRow.terminal_name || selectedRow.workstation_name || "Terminál nie je evidovaný"}</p></div>
                  <span className="table-badge">{getTileState(selectedRow).label}</span>
                </div>

                <article className="mes-selected-machine-order">
                  <div><span>Aktuálna výrobná zákazka</span><strong>{activeRun?.job_number || selectedRow.job_number || "Aktívna zákazka nie je evidovaná"}</strong><p>{activeRun?.item_name || selectedRow.item_name || selectedRow.item_code || "Položka nie je evidovaná"}</p></div>
                  <div className="mes-selected-machine-order-stats"><span>Plán: {formatNumber(activeRun?.planned_quantity || selectedRow.planned_quantity)}</span><span>OK: {formatNumber(activeRun?.good_quantity || selectedRow.good_quantity)}</span><span>NOK: {formatNumber(activeRun?.scrap_quantity || selectedRow.scrap_quantity)}</span><span>{activeRun?.status || selectedRow.job_status || "-"}</span></div>
                </article>

                <div className="mes-selected-machine-metrics">
                  <article className="mes-selected-machine-metric"><span>Prihlásený</span><strong>{activeRun?.operator_name || selectedRow.operator_name || "Operátor nie je prihlásený"}</strong><p>údaj z poslednej známej aktivity stroja</p></article>
                  <article className="mes-selected-machine-metric"><span>Vyrobené kusy</span><strong>{formatNumber(selectedGood + selectedScrap || Number(selectedRow.good_quantity || 0) + Number(selectedRow.scrap_quantity || 0))}</strong><p>{formatNumber(selectedGood || selectedRow.good_quantity)} OK | {formatNumber(selectedScrap || selectedRow.scrap_quantity)} NOK</p></article>
                  <article className="mes-selected-machine-metric"><span>Vyrobené zákazky</span><strong>{formatNumber(completedRuns.length)}</strong><p>dokončené zákazky v načítanej histórii</p></article>
                  <article className="mes-selected-machine-metric"><span>Posledná aktivita</span><strong>{formatDateTime(selectedRow.latest_event_at || selectedRow.machine_last_heartbeat_at)}</strong><p>posledný známy signál zariadenia</p></article>
                </div>
                <MesCharts selectedRow={selectedRow} selectedRuns={selectedRuns} mesEvents={mesEvents} />
              </section>
            )}
          </>
        )}
      </article>

      <article className="orders-panel-card workflow-card workflow-card-list factory-os-mes-panel">
        <div className="panel-head workflow-section-head"><div><p className="workflow-section-kicker">Výroba</p><h2>Posledné výrobné behy</h2><p className="panel-meta">Aktuálne a nedávno ukončené výrobné zákazky.</p></div><span className="table-badge">aktualizované {formatDateTime(lastLoadedAt)}</span></div>
        <div className="table-wrap"><table><thead><tr><th>Zákazka</th><th>Výrobok</th><th>Operátor</th><th>Stav</th><th>Plán</th><th>OK</th><th>NOK</th><th>Začiatok</th></tr></thead><tbody>{jobRuns.map((run) => <tr key={run.id}><td>{run.job_number || "-"}</td><td>{run.item_name || run.item_code || "-"}</td><td>{run.operator_name || "-"}</td><td><span className="table-badge">{run.status || "-"}</span></td><td>{formatNumber(run.planned_quantity)}</td><td>{formatNumber(run.good_quantity)}</td><td>{formatNumber(run.scrap_quantity)}</td><td>{formatDateTime(run.started_at || run.created_at)}</td></tr>)}</tbody></table></div>
      </article>
      </> : (
        <MesAnalyticsExports
          companyId={accessContext.company.id}
          companyName={accessContext.company.name}
          overviewRows={overviewRows}
          jobRuns={jobRuns}
          mesEvents={mesEvents}
          workstations={workstations}
        />
      )}
    </main>
  );
}
