import { useEffect, useMemo, useState } from "react";
import StatusPill from "./components/StatusPill";
import { supabase, tableNames } from "./supabaseClient";
import logo from "../logo.png";

const TABLE_CONFIG = {
  stock: {
    title: "Skladové zásoby",
    subtitle: "Aktuálny stav skladu",
    columns: [
      { label: "Pozícia", keys: ["position"], required: true },
      { label: "Materiál", keys: ["material_code"], required: true },
      { label: "Množstvo", keys: ["quantity"], kind: "number", required: true }
    ],
    searchKeys: ["position", "material_code", "quantity"],
    statusKeys: [],
    timeKeys: [],
    orderBy: "material_code",
    orderAsc: true,
    metricLabel: "Celkové množstvo",
    metricValue: (rows) => rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
  },
  stock_history: {
    title: "História zásob",
    subtitle: "Pohyb zásob a operácie",
    columns: [
      { label: "Operácia", keys: ["action"], kind: "status", required: true },
      { label: "Pozícia", keys: ["position"], required: true },
      { label: "Materiál", keys: ["material_code"], required: true },
      { label: "Poznámka", keys: ["note"] },
      { label: "Vytvorené", keys: ["created_at_ms"], kind: "epoch_ms", required: true }
    ],
    searchKeys: ["action", "position", "material_code", "note", "event_key"],
    statusKeys: ["action"],
    timeKeys: ["created_at_ms"],
    orderBy: "created_at_ms",
    orderAsc: false,
    metricLabel: "Príjmy",
    metricValue: (rows) => rows.filter((row) => String(row.action || "").toUpperCase() === "RECEIVE").length
  }
};

const DEFAULT_CONFIG = {
  title: "Supabase tabuľka",
  subtitle: "Živý monitoring",
  columns: [{ label: "ID", keys: ["id"], required: true }],
  searchKeys: ["id"],
  statusKeys: [],
  timeKeys: [],
  orderBy: null,
  orderAsc: false,
  metricLabel: "Riadky",
  metricValue: (rows) => rows.length
};

const SIMPLE_LOGIN_USER = (import.meta.env.VITE_LOGIN_USER || "admin").trim();
const SIMPLE_LOGIN_PASSWORD = import.meta.env.VITE_LOGIN_PASSWORD || "admin123";
const LANDING_FEATURES = [
  "Online prehľad zásob a pohybov v reálnom čase",
  "Rýchly export dát do Excelu pre operatívu",
  "Filter podľa akcie, pozície a materiálu",
  "Napojenie na Traktile lokátory pre sledovanie presunov"
];

function getTableConfig(table) {
  return TABLE_CONFIG[table] || DEFAULT_CONFIG;
}

function pickValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return null;
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const numeric = Number(value);
  const fromMs = Number.isFinite(numeric) ? new Date(numeric) : null;

  if (fromMs && !Number.isNaN(fromMs.getTime())) {
    return fromMs.toLocaleString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString();
}

function formatCell(value, kind) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (kind === "number") {
    return new Intl.NumberFormat("sk-SK").format(Number(value));
  }

  if (kind === "epoch_ms") {
    return formatDate(value);
  }

  return String(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function translateStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  const statusLabels = {
    all: "všetko",
    receive: "príjem",
    recieve: "príjem",
    issue: "výdaj",
    move: "presun",
    move_all: "presun",
    unknown: "neznáme"
  };

  return statusLabels[normalized] || status;
}

function App() {
  const [selectedTable, setSelectedTable] = useState(tableNames[0]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return window.sessionStorage.getItem("wms_logged_in") === "1";
  });
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const tableConfig = getTableConfig(selectedTable);

  const fetchAllRows = async (table, config) => {
    const pageSize = 1000;
    let from = 0;
    let collected = [];

    while (true) {
      let query = supabase.from(table).select("*").range(from, from + pageSize - 1);

      if (config.orderBy) {
        query = query.order(config.orderBy, { ascending: Boolean(config.orderAsc) });
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        throw queryError;
      }

      const chunk = data || [];
      collected = collected.concat(chunk);

      if (chunk.length < pageSize) {
        break;
      }

      from += pageSize;
    }

    return collected;
  };

  const loadRows = async (table) => {
    setLoading(true);
    setError("");

    try {
      const config = getTableConfig(table);
      const data = await fetchAllRows(table, config);
      setRows(data || []);
    } catch (queryError) {
      setError(queryError?.message || "Nepodarilo sa načítať dáta.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) {
      setRows([]);
      setLoading(false);
      return undefined;
    }

    setStatusFilter("all");
    setSearchTerm("");
    loadRows(selectedTable);

    const channel = supabase
      .channel(`monitor-${selectedTable}`)
      .on("postgres_changes", { event: "*", schema: "public", table: selectedTable }, () => {
        loadRows(selectedTable);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedTable, isLoggedIn]);

  const statuses = useMemo(() => {
    if (tableConfig.statusKeys.length === 0) {
      return ["all"];
    }

    const unique = new Set(
      rows
        .map((row) => pickValue(row, tableConfig.statusKeys))
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
    );

    return ["all", ...Array.from(unique)];
  }, [rows, tableConfig.statusKeys]);

  const filteredRows = useMemo(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesStatus =
        statusFilter === "all" ||
        String(pickValue(row, tableConfig.statusKeys) || "").toLowerCase() === statusFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!normalizedTerm) {
        return true;
      }

      const searchKeys =
        tableConfig.searchKeys && tableConfig.searchKeys.length > 0
          ? tableConfig.searchKeys
          : tableConfig.columns.flatMap((column) => column.keys);

      return searchKeys.some((key) => String(row[key] ?? "").toLowerCase().includes(normalizedTerm));
    });
  }, [rows, statusFilter, searchTerm, tableConfig]);

  const lastTimestamp = useMemo(() => {
    if (tableConfig.timeKeys.length === 0) {
      return "-";
    }

    const candidate = rows
      .map((row) => pickValue(row, tableConfig.timeKeys))
      .find((value) => value !== null && value !== undefined);

    return candidate ? formatDate(candidate) : "-";
  }, [rows, tableConfig.timeKeys]);

  const metricValue = useMemo(() => tableConfig.metricValue(rows), [rows, tableConfig]);
  const hasActiveFilters = statusFilter !== "all" || searchTerm.trim().length > 0;

  const exportToExcel = () => {
    const headers = tableConfig.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    const body = filteredRows
      .map((row) => {
        const cols = tableConfig.columns
          .map((column) => {
            const value = pickValue(row, column.keys);
            const text = column.kind === "status" ? String(value || "neznáme") : formatCell(value, column.kind);
            return `<td>${escapeHtml(text)}</td>`;
          })
          .join("");
        return `<tr>${cols}</tr>`;
      })
      .join("");

    const html = `<!doctype html><html><head><meta charset="UTF-8" /></head><body><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateSuffix = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `${selectedTable}-${dateSuffix}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError("");

    const userOk = authEmail.trim() === SIMPLE_LOGIN_USER;
    const passwordOk = authPassword === SIMPLE_LOGIN_PASSWORD;

    if (!userOk || !passwordOk) {
      setAuthError("Nesprávne meno alebo heslo.");
      setAuthSubmitting(false);
      return;
    }

    window.sessionStorage.setItem("wms_logged_in", "1");
    setIsLoggedIn(true);
    setAuthSubmitting(false);
    setAuthPassword("");
  };

  const handleSignOut = async () => {
    window.sessionStorage.removeItem("wms_logged_in");
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return (
      <main className="container landing-screen">
        <section className="landing-layout">
          <article className="landing-card">
            <img src={logo} alt="WMS Online" className="landing-logo" />
            <p className="landing-tag">WMS Online</p>
            <h1>Moderný skladový monitoring na jednom mieste</h1>
            <p className="subtitle">
              Sleduj zásoby, príjmy, výdaje a presuny v jednej aplikácii s okamžitou aktualizáciou dát.
            </p>

            <ul className="landing-list">
              {LANDING_FEATURES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div className="landing-note">
              <h2>Traktile lokátory</h2>
              <p>
                Integrácia Traktile lokátorov ti umožní spárovať fyzickú pozíciu vozíka alebo palety s operáciami v
                systéme a zjednotiť presuny do jedného dátového toku.
              </p>
            </div>
          </article>

          <section className="login-card">
            <h2>Prihlásenie</h2>
            <p className="subtitle">Zadaj meno a heslo pre prístup do monitoru.</p>
            <form className="login-form" onSubmit={handleSignIn}>
              <label className="login-label" htmlFor="email">
                Meno
              </label>
              <input
                id="email"
                type="text"
                className="search-input"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                required
                autoComplete="username"
              />
              <label className="login-label" htmlFor="password">
                Heslo
              </label>
              <input
                id="password"
                type="password"
                className="search-input"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
              <button type="submit" className="refresh-btn" disabled={authSubmitting}>
                {authSubmitting ? "Prihlasujem..." : "Prihlásiť sa"}
              </button>
            </form>
            {authError && <p className="error">{authError}</p>}
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="hero-top">
          <div className="brand">
            <img src={logo} alt="Logo" className="brand-logo" />
          </div>
          <span className="table-badge">{selectedTable}</span>
        </div>
        <h1>{tableConfig.title}</h1>
        <p className="subtitle">{tableConfig.subtitle}</p>

        <div className="actions-row">
          <div className="table-switch" role="tablist" aria-label="Výber tabuľky">
            {tableNames.map((table) => (
              <button
                key={table}
                type="button"
                className={`table-btn ${table === selectedTable ? "table-btn-active" : ""}`}
                onClick={() => setSelectedTable(table)}
              >
                {table}
              </button>
            ))}
          </div>

          <div className="action-buttons">
            <button type="button" onClick={exportToExcel} className="export-btn">
              Export do Excelu
            </button>
            <button type="button" onClick={() => loadRows(selectedTable)} className="refresh-btn">
              Obnoviť
            </button>
            <button type="button" onClick={handleSignOut} className="logout-btn">
              Odhlásiť sa
            </button>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <article className="card">
          <p>Počet riadkov</p>
          <strong>{rows.length}</strong>
        </article>
        <article className="card">
          <p>{tableConfig.metricLabel}</p>
          <strong>{new Intl.NumberFormat("sk-SK").format(metricValue)}</strong>
        </article>
        <article className="card">
          <p>Posledná zmena</p>
          <strong className="small-text">{lastTimestamp}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Dátový tok</h2>
            <p className="panel-meta">
              Zobrazených {filteredRows.length} / {rows.length} riadkov
            </p>
          </div>
          <div className="panel-controls">
            <input
              type="search"
              className="search-input"
              placeholder="Hľadaj materiál, pozíciu, poznámku..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            {statuses.length > 1 && (
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {translateStatusLabel(status)}
                  </option>
                ))}
              </select>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                className="clear-btn"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                }}
              >
                Vymazať filter
              </button>
            )}
          </div>
        </div>

        {loading && <p className="hint">Načítavam dáta...</p>}
        {error && <p className="error">{error}</p>}

        {!loading && !error && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {tableConfig.columns.map((column) => (
                    <th key={column.label}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => (
                  <tr key={row.event_key || `${selectedTable}-${index}`}>
                    {tableConfig.columns.map((column) => {
                      const value = pickValue(row, column.keys);
                      return (
                        <td key={`${column.label}-${row.event_key || row.position || index}`}>
                          {column.kind === "status" ? (
                            <StatusPill status={String(value || "unknown")} />
                          ) : (
                            formatCell(value, column.kind)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredRows.length === 0 && (
              <div className="empty-state">
                <p>Pre tento filter nie sú dáta.</p>
                <button
                  type="button"
                  className="clear-btn"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("all");
                  }}
                >
                  Resetovať filter
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
