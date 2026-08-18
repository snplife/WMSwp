import { useMemo, useState } from "react";
import {
  ArrowRight, Clock3, Factory, LocateFixed, MapPinned, Maximize2,
  Minus, PackageCheck, Plus, Search, UserRound, X
} from "lucide-react";

const MACHINE_LAYOUT = {
  F16: [7.6, 28, 6, 33], F04: [14.2, 28, 6, 33], F02: [20.8, 28, 6, 33], F11: [27.3, 28, 5, 33],
  F14: [34, 28, 6, 33], F09: [41.1, 28, 6, 33], F20: [47.6, 28, 5, 33], A33: [54.6, 28, 6, 33],
  F22: [63.6, 28, 6, 33], F21: [71.6, 28, 6, 33], F18: [79.3, 19, 8, 9], F23: [92, 16.5, 13, 12],
  F15: [81.5, 27, 8.5, 5.5], F12: [81.5, 35.5, 8.5, 5.5], F13: [81.5, 43.5, 8.5, 5.5],
  F17: [30.4, 73.5, 4.5, 22], F07: [36.2, 73.5, 4.5, 22], F06: [42, 73.5, 4.5, 22],
  F08: [47.9, 73.5, 4.5, 22], F10: [53.8, 73.5, 4.5, 22]
};

const FILTERS = [
  ["all", "Všetky"], ["running", "V prevádzke"], ["downtime", "Prestoj"],
  ["setup", "Nastavenie"], ["unassigned", "Bez terminálu"], ["offline", "Offline"]
];

function normalizeCode(row) {
  const source = `${row?.machine_code || ""} ${row?.workstation_code || ""} ${row?.machine_name || ""}`.toUpperCase();
  return source.match(/(?:F\d{2}|A\d{2})/)?.[0] || String(row?.machine_code || row?.workstation_code || "").toUpperCase();
}

function getMachineKey(row) {
  return String(row?.machine_id || row?.workstation_id || "");
}

function fallbackPosition(index) {
  return [6 + (index % 10) * 8.6, 91 + Math.floor(index / 10) * 5, 6, 6];
}

function getMapStatus(row, resolveStatus) {
  if (!row?.terminal_id) return { key: "unassigned", label: "Bez terminálu" };
  return resolveStatus(row);
}

export default function ScherdelFactoryMap({
  rows, selectedMachineKey, onSelectMachine, onOpenTerminal, resolveStatus, loading
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);

  const mapRows = useMemo(() => rows.map((row, index) => {
    const code = normalizeCode(row);
    return {
      row,
      code,
      status: getMapStatus(row, resolveStatus),
      layout: MACHINE_LAYOUT[code] || fallbackPosition(index)
    };
  }), [resolveStatus, rows]);

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
  const completion = selectedRow && Number(selectedRow.planned_quantity) > 0
    ? Math.min(100, Number(selectedRow.good_quantity || 0) / Number(selectedRow.planned_quantity) * 100)
    : 0;

  return (
    <section className="scherdel-map-shell">
      <header className="scherdel-map-header">
        <div className="scherdel-map-title">
          <span><MapPinned size={16} /> Digitálny pôdorys · Hala 2</span>
          <h2>Live factory map</h2>
          <p>Aktuálny stav výrobných zariadení v reálnom čase</p>
        </div>
        <div className="scherdel-map-live"><i /> LIVE <small>{rows.length} zariadení</small></div>
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
                  onClick={() => onSelectMachine(getMachineKey(row))}
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
            <dl>
              <div><dt><Factory /> Zákazka</dt><dd>{selectedRow.job_number || "Bez aktívnej zákazky"}</dd></div>
              <div><dt><PackageCheck /> Výrobok</dt><dd>{selectedRow.item_code || selectedRow.item_name || "—"}</dd></div>
              <div><dt><UserRound /> Operátor</dt><dd>{selectedRow.operator_name || "Neprihlásený"}</dd></div>
              <div><dt><Clock3 /> Posledná udalosť</dt><dd>{selectedRow.latest_event_at ? new Intl.DateTimeFormat("sk-SK", { hour: "2-digit", minute: "2-digit" }).format(new Date(selectedRow.latest_event_at)) : "—"}</dd></div>
            </dl>
            <div className="scherdel-map-output"><div><span>Plnenie plánu</span><b>{Math.round(completion)}%</b></div><div className="track"><i style={{ width: `${completion}%` }} /></div><small>{Number(selectedRow.good_quantity || 0).toLocaleString("sk-SK")} / {Number(selectedRow.planned_quantity || 0).toLocaleString("sk-SK")} ks</small></div>
            <button className="scherdel-map-terminal" type="button" onClick={onOpenTerminal}>Otvoriť terminál <ArrowRight size={16} /></button>
          </aside>
        ) : null}

        {!loading && rows.length === 0 ? <div className="scherdel-map-empty"><LocateFixed /><strong>Žiadne zariadenia</strong><span>Po pridaní MES strojov sa zobrazia priamo v pôdoryse.</span></div> : null}
      </div>

      <footer className="scherdel-map-legend"><span><i className="running" />Automatický cyklus</span><span><i className="setup" />Nastavenie</span><span><i className="downtime" />Prestoj</span><span><i className="maintenance" />Servis</span><span><i className="unassigned" />Bez terminálu</span><span><i className="offline" />Offline</span></footer>
    </section>
  );
}
