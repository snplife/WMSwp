import { useMemo, useState } from "react";
import {
  ArrowRight, Clock3, Factory, MapPinned, Maximize2,
  Minus, PackageCheck, Plus, Search, UserRound, X
} from "lucide-react";
import { supabase } from "../../supabaseClient";

const STATIC_MACHINE_SLOTS = [
  ["F16", "BMS36", 7.6, 28, 6, 33], ["F04", "BMS4", 14.2, 28, 6, 33],
  ["F02", "BMS4", 20.8, 28, 6, 33], ["F11", "Numalliance R2106", 27.3, 28, 5, 33],
  ["F14", "BMS31", 34, 28, 6, 33], ["F09", "BMS31", 41.1, 28, 6, 33],
  ["F20", "Numalliance R2110", 47.6, 28, 5, 33], ["A33", "BT3.2", 54.6, 28, 6, 33],
  ["F22", "BMS4", 63.6, 28, 6, 33], ["F21", "BMS4", 71.6, 28, 6, 33],
  ["F18", "Manipulátor", 79.3, 19, 8, 9], ["F23", "BMS4", 92, 16.5, 13, 12],
  ["F15", "B3", 81.5, 27, 8.5, 5.5], ["F12", "B3", 81.5, 35.5, 8.5, 5.5],
  ["F13", "B3", 81.5, 43.5, 8.5, 5.5], ["F17", "BM41", 30.4, 73.5, 4.5, 22],
  ["F07", "BM3", 36.2, 73.5, 4.5, 22], ["F06", "BM41", 42, 73.5, 4.5, 22],
  ["F08", "BM30", 47.9, 73.5, 4.5, 22], ["F10", "BM30", 53.8, 73.5, 4.5, 22]
].map(([code, name, left, top, width, height], index) => ({ code, name, layout: [left, top, width, height], sortOrder: (index + 1) * 10 }));

const SLOT_CODE_SET = new Set(STATIC_MACHINE_SLOTS.map((slot) => slot.code));

const FILTERS = [
  ["all", "Všetky"], ["running", "V prevádzke"], ["downtime", "Prestoj"],
  ["setup", "Nastavenie"], ["unassigned", "Bez terminálu"], ["offline", "Offline"]
];

function normalizeCode(row) {
  const source = `${row?.machine_code || ""} ${row?.workstation_code || ""} ${row?.machine_name || ""}`.toUpperCase();
  return source.match(/(?:F\d{2}|A\d{2})/)?.[0] || String(row?.machine_code || row?.workstation_code || "").toUpperCase();
}

function getMachineKey(row) {
  return String(row?._mapKey || row?.machine_id || row?.workstation_id || "");
}

function fallbackPosition(index) {
  return [6 + (index % 10) * 8.6, 91 + Math.floor(index / 10) * 5, 6, 6];
}

function getMapStatus(row, resolveStatus) {
  if (!row?.terminal_id) return { key: "unassigned", label: "Bez terminálu" };
  return resolveStatus(row);
}

function normalizeTerminalCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  const suffix = raw.replace(/^(?:P40-|P4-|UID-)/, "");
  return /^[0-9A-F]{12}$/.test(suffix) ? `P4-${suffix}` : raw;
}

export default function ScherdelFactoryMap({
  rows, selectedMachineKey, onSelectMachine, onOpenTerminal, resolveStatus,
  companyId, userId, onRefresh
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [terminalCode, setTerminalCode] = useState("");
  const [terminalPlatform, setTerminalPlatform] = useState("raspberry_pi");
  const [registrationState, setRegistrationState] = useState({ saving: false, error: "", success: "" });

  const mapRows = useMemo(() => {
    const rowByCode = new Map();
    rows.forEach((row) => {
      const code = normalizeCode(row);
      if (code && !rowByCode.has(code)) rowByCode.set(code, row);
    });
    const staticRows = STATIC_MACHINE_SLOTS.map((slot) => {
      const storedRow = rowByCode.get(slot.code);
      const row = storedRow || {
        _mapKey: `slot:${slot.code}`,
        machine_code: slot.code,
        machine_name: slot.name,
        workstation_code: slot.code,
        workstation_name: slot.name,
        terminal_id: null
      };
      return { row, code: slot.code, slot, status: getMapStatus(row, resolveStatus), layout: slot.layout };
    });
    const extraRows = rows.flatMap((row, index) => {
      const code = normalizeCode(row);
      return SLOT_CODE_SET.has(code) ? [] : [{ row, code, slot: null, status: getMapStatus(row, resolveStatus), layout: fallbackPosition(index) }];
    });
    return [...staticRows, ...extraRows];
  }, [resolveStatus, rows]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("sk-SK");
    return mapRows.filter(({ row, status }) => {
      const matchesFilter = filter === "all" || status.key === filter;
      const haystack = `${row.machine_code || ""} ${row.workstation_code || ""} ${row.machine_name || ""} ${row.workstation_name || ""} ${row.job_number || ""}`.toLocaleLowerCase("sk-SK");
      return matchesFilter && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [filter, mapRows, query]);

  const selectedMapRow = mapRows.find(({ row }) => getMachineKey(row) === selectedMachineKey) || null;
  const selectedRow = selectedMapRow?.row || null;
  const selectedStatus = selectedMapRow?.status || null;
  const assignedCount = mapRows.reduce((count, entry) => count + (entry.row.terminal_id ? 1 : 0), 0);
  const completion = selectedRow && Number(selectedRow.planned_quantity) > 0
    ? Math.min(100, Number(selectedRow.good_quantity || 0) / Number(selectedRow.planned_quantity) * 100)
    : 0;

  const handleSelectMachine = (key) => {
    onSelectMachine(key);
    setRegistrationState({ saving: false, error: "", success: "" });
    setTerminalCode("");
  };

  const handleRegisterTerminal = async (event) => {
    event.preventDefault();
    if (!selectedMapRow || selectedMapRow.status.key !== "unassigned") return;
    const normalizedCode = normalizeTerminalCode(terminalCode);
    if (!normalizedCode) {
      setRegistrationState({ saving: false, error: "Zadaj UID alebo kód terminálu.", success: "" });
      return;
    }
    setRegistrationState({ saving: true, error: "", success: "" });
    try {
      const slot = selectedMapRow.slot || {
        code: selectedMapRow.code,
        name: selectedRow.machine_name || selectedRow.workstation_name || selectedMapRow.code,
        sortOrder: 999
      };
      let workstationId = selectedRow.workstation_id || null;
      if (!workstationId) {
        const { data: storedWorkstation, error: workstationLookupError } = await supabase
          .from("mes_workstations").select("id").eq("company_id", companyId).eq("code", slot.code).maybeSingle();
        if (workstationLookupError) throw workstationLookupError;
        if (storedWorkstation) {
          workstationId = storedWorkstation.id;
        } else {
          const { data: createdWorkstation, error: workstationError } = await supabase.from("mes_workstations").insert({
            company_id: companyId, code: slot.code, name: slot.name, area: "Hala 2",
            hmi_enabled: true, sort_order: slot.sortOrder, is_active: true, created_by: userId, updated_by: userId
          }).select("id").single();
          if (workstationError) throw workstationError;
          workstationId = createdWorkstation.id;
        }
      }

      if (!selectedRow.machine_id) {
        const { data: storedMachine, error: machineLookupError } = await supabase
          .from("mes_machines").select("id").eq("workstation_id", workstationId).eq("code", slot.code).maybeSingle();
        if (machineLookupError) throw machineLookupError;
        if (!storedMachine) {
          const { error: machineError } = await supabase.from("mes_machines").insert({
            workstation_id: workstationId, code: slot.code, name: slot.name,
            machine_state: "idle", is_active: true, created_by: userId, updated_by: userId
          });
          if (machineError) throw machineError;
        }
      }

      const { data: storedTerminal, error: terminalLookupError } = await supabase
        .from("mes_hmi_terminals").select("id").eq("company_id", companyId).eq("terminal_code", normalizedCode).maybeSingle();
      if (terminalLookupError) throw terminalLookupError;
      const terminalPayload = {
        company_id: companyId, workstation_id: workstationId, terminal_code: normalizedCode,
        name: `${slot.code} terminál`, platform: terminalPlatform, app_mode: "hmi",
        is_active: true, updated_by: userId
      };
      if (storedTerminal) {
        const { error } = await supabase.from("mes_hmi_terminals").update(terminalPayload).eq("id", storedTerminal.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("mes_hmi_terminals").insert({ ...terminalPayload, created_by: userId });
        if (error) throw error;
      }
      setRegistrationState({ saving: false, error: "", success: `Terminál ${normalizedCode} bol priradený.` });
      await onRefresh();
      onSelectMachine("");
    } catch (error) {
      setRegistrationState({ saving: false, error: error?.message || "Terminál sa nepodarilo priradiť.", success: "" });
    }
  };

  return (
    <section className="scherdel-map-shell">
      <header className="scherdel-map-header">
        <div className="scherdel-map-title">
          <span><MapPinned size={16} /> Digitálny pôdorys · Hala 2</span>
          <h2>Live factory map</h2>
          <p>Aktuálny stav výrobných zariadení v reálnom čase</p>
        </div>
        <div className="scherdel-map-live"><i /> LIVE <small>{assignedCount} / {mapRows.length} priradených</small></div>
      </header>

      <div className="scherdel-map-toolbar">
        <label className="scherdel-map-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nájsť stroj alebo zákazku" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Vymazať vyhľadávanie"><X size={14} /></button> : null}</label>
        <div className="scherdel-map-filters" aria-label="Filtrovať stroje podľa stavu">
          {FILTERS.map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        <div className="scherdel-map-zoom">
          <button type="button" onClick={() => setZoom((value) => Math.max(.85, value - .15))} aria-label="Oddialiť mapu"><Minus size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(1.75, value + .15))} aria-label="Priblížiť mapu"><Plus size={16} /></button>
          <button type="button" onClick={() => setZoom(1)} aria-label="Obnoviť priblíženie"><Maximize2 size={16} /></button>
        </div>
      </div>

      <div className="scherdel-map-stage">
        <div className="scherdel-map-scroll">
          <div className="scherdel-map-canvas" style={{ width: `${zoom * 100}%` }}>
            <img src="/brands/scherdel-hala2-layout.png" alt="Pôdorys výrobnej haly 2 Scherdel" draggable="false" />
            <div className="scherdel-map-grid" aria-hidden="true" />
            <div className="scherdel-map-hall-label"><span>02</span><div>VÝROBNÁ HALA<strong>MYJAVA · LIVE</strong></div></div>
            {visibleRows.map(({ row, code, status, layout }) => {
              const [left, top, width, height] = layout;
              const isSelected = getMachineKey(row) === selectedMachineKey;
              return (
                <button
                  type="button"
                  key={getMachineKey(row)}
                  className={`scherdel-map-marker ${status.key} ${isSelected ? "selected" : ""}`}
                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                  onClick={() => handleSelectMachine(getMachineKey(row))}
                  aria-label={`${code || row.machine_name}: ${status.label}`}
                >
                  <span className="scherdel-map-marker-label">
                    <i />
                    <b>{code || row.machine_code || "MES"}</b>
                    <small>{status.label}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {selectedRow ? (
          <aside className={`scherdel-map-detail ${selectedStatus.key}`}>
            <div className="scherdel-map-detail-head"><span>{normalizeCode(selectedRow) || selectedRow.workstation_code}</span><button type="button" onClick={() => onSelectMachine("")} aria-label="Zavrieť detail"><X size={16} /></button></div>
            <h3>{selectedRow.machine_name || selectedRow.workstation_name}</h3>
            <p className="scherdel-map-state"><i />{selectedStatus.label}</p>
            {selectedStatus.key === "unassigned" ? <form className="scherdel-terminal-register" onSubmit={handleRegisterTerminal}>
              <p>Priraď terminál jednorazovo. Pracovisko a stroj sa pri prvom použití vytvoria automaticky.</p>
              <label><span>UID / kód terminálu</span><input value={terminalCode} onChange={(event) => setTerminalCode(event.target.value)} placeholder="P4-AABBCCDDEEFF" autoFocus /></label>
              <label><span>Typ zariadenia</span><select value={terminalPlatform} onChange={(event) => setTerminalPlatform(event.target.value)}><option value="raspberry_pi">Raspberry Pi</option><option value="android">Android</option><option value="web_kiosk">Web kiosk</option><option value="other">Iné</option></select></label>
              {registrationState.error ? <small className="error">{registrationState.error}</small> : null}
              {registrationState.success ? <small className="success">{registrationState.success}</small> : null}
              <button type="submit" disabled={registrationState.saving}>{registrationState.saving ? "Priraďujem…" : "Pridať terminál"}<ArrowRight size={16} /></button>
            </form> : <><dl>
              <div><dt><Factory /> Zákazka</dt><dd>{selectedRow.job_number || "Bez aktívnej zákazky"}</dd></div>
              <div><dt><PackageCheck /> Výrobok</dt><dd>{selectedRow.item_code || selectedRow.item_name || "—"}</dd></div>
              <div><dt><UserRound /> Operátor</dt><dd>{selectedRow.operator_name || "Neprihlásený"}</dd></div>
              <div><dt><Clock3 /> Posledná udalosť</dt><dd>{selectedRow.latest_event_at ? new Intl.DateTimeFormat("sk-SK", { hour: "2-digit", minute: "2-digit" }).format(new Date(selectedRow.latest_event_at)) : "—"}</dd></div>
            </dl>
            <div className="scherdel-map-output"><div><span>Plnenie plánu</span><b>{Math.round(completion)}%</b></div><div className="track"><i style={{ width: `${completion}%` }} /></div><small>{Number(selectedRow.good_quantity || 0).toLocaleString("sk-SK")} / {Number(selectedRow.planned_quantity || 0).toLocaleString("sk-SK")} ks</small></div>
            <button className="scherdel-map-terminal" type="button" onClick={onOpenTerminal}>Otvoriť terminál <ArrowRight size={16} /></button></>}
          </aside>
        ) : null}
      </div>

      <footer className="scherdel-map-legend"><span><i className="running" />Automatický cyklus</span><span><i className="setup" />Nastavenie</span><span><i className="downtime" />Prestoj</span><span><i className="maintenance" />Servis</span><span><i className="unassigned" />Bez terminálu</span><span><i className="offline" />Offline</span></footer>
    </section>
  );
}
