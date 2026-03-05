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
const ENV_DEFAULT_DEAD_STOCK_DAYS = Math.max(1, Number(import.meta.env.VITE_DEAD_STOCK_DAYS || 30));
const ENV_DEFAULT_MAX_POSITIONS = Math.max(1, Number(import.meta.env.VITE_MAX_POSITIONS || 100));
const LANDING_FEATURES = [
  "Online prehľad zásob a pohybov v reálnom čase",
  "Rýchly export dát do Excelu pre operatívu",
  "Filter podľa akcie, pozície a materiálu",
  "Napojenie na Traktile lokátory pre sledovanie presunov"
];

function getTableConfig(table) {
  return TABLE_CONFIG[table] || DEFAULT_CONFIG;
}

function makeStockKey(position, materialCode) {
  return `${String(position || "").trim()}::${String(materialCode || "").trim()}`;
}

function normalizeDeadStockDays(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return ENV_DEFAULT_DEAD_STOCK_DAYS;
  }
  return Math.min(3650, Math.max(1, parsed));
}

function normalizeMaxPositions(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return ENV_DEFAULT_MAX_POSITIONS;
  }
  return Math.min(1000000, Math.max(1, parsed));
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
  const [stockViewMode, setStockViewMode] = useState("table");
  const [expandedPositions, setExpandedPositions] = useState({});
  const [deadStockByKey, setDeadStockByKey] = useState({});
  const [showDeadStockOnly, setShowDeadStockOnly] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [deadStockDays, setDeadStockDays] = useState(() => {
    const saved = window.localStorage.getItem("wms_dead_stock_days");
    return normalizeDeadStockDays(saved ?? ENV_DEFAULT_DEAD_STOCK_DAYS);
  });
  const [maxPositions, setMaxPositions] = useState(() => {
    const saved = window.localStorage.getItem("wms_max_positions");
    return normalizeMaxPositions(saved ?? ENV_DEFAULT_MAX_POSITIONS);
  });
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

      if (table !== "stock") {
        setDeadStockByKey({});
        return;
      }

      const historyRows = await fetchAllRows("stock_history", getTableConfig("stock_history"));
      const now = Date.now();
      const deadStockMs = deadStockDays * 24 * 60 * 60 * 1000;
      const latestMovementMsByKey = {};

      for (const historyRow of historyRows) {
        const key = makeStockKey(historyRow.position, historyRow.material_code);
        if (!key || key === "::") {
          continue;
        }

        const createdAtMs = Number(historyRow.created_at_ms);
        if (!Number.isFinite(createdAtMs)) {
          continue;
        }

        const latest = latestMovementMsByKey[key];
        if (!Number.isFinite(latest) || createdAtMs > latest) {
          latestMovementMsByKey[key] = createdAtMs;
        }
      }

      const deadMap = {};
      for (const stockRow of data || []) {
        const quantity = Number(stockRow.quantity || 0);
        if (!(quantity > 0)) {
          continue;
        }

        const key = makeStockKey(stockRow.position, stockRow.material_code);
        const lastMoveMs = latestMovementMsByKey[key];
        const inactiveMs = Number.isFinite(lastMoveMs) ? now - lastMoveMs : Number.POSITIVE_INFINITY;
        if (inactiveMs < deadStockMs) {
          continue;
        }

        deadMap[key] = {
          inactiveDays: Number.isFinite(inactiveMs) ? Math.floor(inactiveMs / (24 * 60 * 60 * 1000)) : null,
          lastMoveMs: Number.isFinite(lastMoveMs) ? lastMoveMs : null
        };
      }
      setDeadStockByKey(deadMap);
    } catch (queryError) {
      setError(queryError?.message || "Nepodarilo sa načítať dáta.");
      setRows([]);
      setDeadStockByKey({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    window.localStorage.setItem("wms_dead_stock_days", String(deadStockDays));
  }, [deadStockDays]);

  useEffect(() => {
    window.localStorage.setItem("wms_max_positions", String(maxPositions));
  }, [maxPositions]);

  useEffect(() => {
    if (!isLoggedIn) {
      setRows([]);
      setLoading(false);
      return undefined;
    }

    setStatusFilter("all");
    setSearchTerm("");
    setShowDeadStockOnly(false);
    setExpandedPositions({});
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
  }, [selectedTable, isLoggedIn, deadStockDays]);

  useEffect(() => {
    if (!isLoggedIn) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      loadRows(selectedTable);
    }, 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoggedIn, selectedTable, deadStockDays]);

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
      if (selectedTable === "stock" && showDeadStockOnly) {
        const rowKey = makeStockKey(row.position, row.material_code);
        if (!deadStockByKey[rowKey]) {
          return false;
        }
      }

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
  }, [rows, statusFilter, searchTerm, tableConfig, selectedTable, showDeadStockOnly, deadStockByKey]);

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
  const issueCount = useMemo(() => {
    if (selectedTable !== "stock_history") {
      return 0;
    }
    return rows.filter((row) => String(row.action || "").toUpperCase() === "ISSUE").length;
  }, [rows, selectedTable]);
  const deadStockCount = useMemo(() => Object.keys(deadStockByKey).length, [deadStockByKey]);
  const groupedStockRows = useMemo(() => {
    if (selectedTable !== "stock") {
      return [];
    }

    const groupsByPosition = {};
    for (const row of filteredRows) {
      const position = String(row.position || "-").trim() || "-";
      const quantity = Number(row.quantity || 0);
      const stockKey = makeStockKey(row.position, row.material_code);

      if (!groupsByPosition[position]) {
        groupsByPosition[position] = {
          position,
          rows: [],
          totalQuantity: 0,
          deadCount: 0
        };
      }

      groupsByPosition[position].rows.push(row);
      groupsByPosition[position].totalQuantity += Number.isFinite(quantity) ? quantity : 0;
      if (deadStockByKey[stockKey]) {
        groupsByPosition[position].deadCount += 1;
      }
    }

    return Object.values(groupsByPosition).sort((a, b) =>
      a.position.localeCompare(b.position, "sk-SK", { numeric: true, sensitivity: "base" })
    );
  }, [filteredRows, selectedTable, deadStockByKey]);
  const positionUsageMap = useMemo(() => {
    if (selectedTable !== "stock") {
      return {};
    }

    const usage = {};
    for (const row of rows) {
      const positionKey = String(row.position || "").trim();
      if (!positionKey) {
        continue;
      }
      usage[positionKey] = (usage[positionKey] || 0) + 1;
    }
    return usage;
  }, [rows, selectedTable]);
  const sharedPositionsCount = useMemo(
    () => Object.values(positionUsageMap).filter((count) => count > 1).length,
    [positionUsageMap]
  );
  const maxItemsInOnePosition = useMemo(
    () => Object.values(positionUsageMap).reduce((max, count) => Math.max(max, Number(count || 0)), 0),
    [positionUsageMap]
  );
  const topSharedPositions = useMemo(
    () =>
      Object.entries(positionUsageMap)
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
    [positionUsageMap]
  );
  const occupiedPositions = useMemo(() => {
    if (selectedTable !== "stock") {
      return 0;
    }
    return new Set(rows.map((row) => String(row.position || "").trim()).filter(Boolean)).size;
  }, [rows, selectedTable]);
  const freePositions = useMemo(() => Math.max(0, maxPositions - occupiedPositions), [maxPositions, occupiedPositions]);
  const occupancyPercent = useMemo(() => (occupiedPositions / maxPositions) * 100, [occupiedPositions, maxPositions]);
  const occupancyLevel = useMemo(() => {
    if (occupancyPercent < 70) {
      return "ok";
    }
    if (occupancyPercent <= 90) {
      return "warn";
    }
    return "critical";
  }, [occupancyPercent]);
  const occupancyLabel = occupancyLevel === "ok" ? "Nízke" : occupancyLevel === "warn" ? "Stredné" : "Vysoké";
  const hasActiveFilters =
    statusFilter !== "all" || searchTerm.trim().length > 0 || (selectedTable === "stock" && showDeadStockOnly);

  const togglePositionExpanded = (position) => {
    setExpandedPositions((prev) => ({ ...prev, [position]: !prev[position] }));
  };

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
            <button type="button" onClick={() => setIsSettingsOpen(true)} className="settings-btn">
              Nastavenia
            </button>
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
        {selectedTable !== "stock" && (
          <article className="card">
            <p>Počet riadkov</p>
            <strong>{rows.length}</strong>
          </article>
        )}
        <article className="card">
          <p>{tableConfig.metricLabel}</p>
          <strong>{new Intl.NumberFormat("sk-SK").format(metricValue)}</strong>
        </article>
        {selectedTable === "stock_history" && (
          <article className="card">
            <p>Výdaje</p>
            <strong>{new Intl.NumberFormat("sk-SK").format(issueCount)}</strong>
          </article>
        )}
        <article className="card">
          <p>Posledná zmena</p>
          <strong className="small-text">{lastTimestamp}</strong>
        </article>
        {selectedTable === "stock" && (
          <article className={`card ${deadStockCount > 0 ? "card-alert" : ""}`}>
            <p>Dead stock ({deadStockDays} dní)</p>
            <strong>{new Intl.NumberFormat("sk-SK").format(deadStockCount)}</strong>
          </article>
        )}
        {selectedTable === "stock" && (
          <article className={`card occupancy-${occupancyLevel}`}>
            <p>Zaplnenie skladu</p>
            <strong className={`occupancy-value occupancy-value-${occupancyLevel}`}>
              {`${new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 1 }).format(occupancyPercent)} %`}
            </strong>
            <p className="occupancy-meta">{`Obsadené: ${occupiedPositions} / ${maxPositions}`}</p>
            <p className={`occupancy-badge occupancy-badge-${occupancyLevel}`}>{`Stav: ${occupancyLabel}`}</p>
          </article>
        )}
        {selectedTable === "stock" && (
          <article className="card">
            <p>Voľné miesta</p>
            <strong>{new Intl.NumberFormat("sk-SK").format(freePositions)}</strong>
          </article>
        )}
        {selectedTable === "stock" && (
          <article className={`card ${maxItemsInOnePosition >= 5 ? "card-shared-strong" : "card-shared"}`}>
            <p>Zdieľané pozície</p>
            <strong>{new Intl.NumberFormat("sk-SK").format(sharedPositionsCount)}</strong>
            <p className="occupancy-meta">{`Max na 1 pozícii: ${maxItemsInOnePosition}`}</p>
          </article>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Dátový tok</h2>
            <p className="panel-meta">
              Zobrazených {filteredRows.length} / {rows.length} riadkov
            </p>
            {selectedTable === "stock" && deadStockCount > 0 && (
              <p className="dead-stock-meta">
                Alert: {deadStockCount} položiek bez pohybu aspoň {deadStockDays} dní.
              </p>
            )}
            {selectedTable === "stock" && topSharedPositions.length > 0 && (
              <p className="shared-position-meta">
                Zdieľané pozície:
                {` ${topSharedPositions.map(([position, count]) => `${position} (${count}x)`).join(", ")}`}
              </p>
            )}
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
            {selectedTable === "stock" && (
              <div className="stock-view-switch" role="tablist" aria-label="Režim zobrazenia stock">
                <button
                  type="button"
                  className={`clear-btn ${stockViewMode === "table" ? "stock-view-btn-active" : ""}`}
                  onClick={() => setStockViewMode("table")}
                >
                  Tabuľka
                </button>
                <button
                  type="button"
                  className={`clear-btn ${stockViewMode === "position" ? "stock-view-btn-active" : ""}`}
                  onClick={() => setStockViewMode("position")}
                >
                  Podľa pozícií
                </button>
              </div>
            )}
            {selectedTable === "stock" && (
              <button
                type="button"
                className={`clear-btn ${showDeadStockOnly ? "dead-stock-btn-active" : ""}`}
                onClick={() => setShowDeadStockOnly((prev) => !prev)}
              >
                {showDeadStockOnly ? "Zobraziť všetko" : "Len dead stock"}
              </button>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                className="clear-btn"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                  setShowDeadStockOnly(false);
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
          <>
            {selectedTable === "stock" && stockViewMode === "position" ? (
              <div className="position-groups">
                {groupedStockRows.map((group) => {
                  const isOpen = Boolean(expandedPositions[group.position]);
                  return (
                    <article key={group.position} className="position-group-card">
                      <button type="button" className="position-group-head" onClick={() => togglePositionExpanded(group.position)}>
                        <div>
                          <strong>{group.position}</strong>
                          <p>{`${group.rows.length} materiálov | ${new Intl.NumberFormat("sk-SK").format(group.totalQuantity)} ks`}</p>
                        </div>
                        <div className="position-group-right">
                          {group.deadCount > 0 && <span className="dead-stock-inline">{`dead ${group.deadCount}`}</span>}
                          <span className="shared-position-inline">{isOpen ? "Zbaliť" : "Rozbaliť"}</span>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="position-group-table-wrap">
                          <table className="position-group-table">
                            <thead>
                              <tr>
                                <th>Materiál</th>
                                <th>Množstvo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row, rowIndex) => {
                                const stockKey = makeStockKey(row.position, row.material_code);
                                const deadInfo = deadStockByKey[stockKey];
                                const deadHint =
                                  deadInfo && deadInfo.inactiveDays !== null
                                    ? `Dead stock: bez pohybu ${deadInfo.inactiveDays} dní`
                                    : deadInfo
                                      ? "Dead stock: bez záznamu pohybu"
                                      : "";
                                return (
                                  <tr key={`${group.position}-${row.material_code}-${rowIndex}`}>
                                    <td>
                                      {formatCell(row.material_code, null)}
                                      {deadHint && (
                                        <span className="dead-stock-inline" title={deadHint}>
                                          dead stock
                                        </span>
                                      )}
                                    </td>
                                    <td>{formatCell(row.quantity, "number")}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
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
                    {filteredRows.map((row, index) => {
                      const positionKey = String(row.position || "").trim();
                      const positionCount = positionUsageMap[positionKey] || 0;
                      const isSharedPosition = selectedTable === "stock" && positionCount > 1;
                      const isStrongSharedPosition = selectedTable === "stock" && positionCount >= 5;

                      return (
                        <tr
                          key={row.event_key || `${selectedTable}-${index}`}
                          className={
                            [
                              selectedTable === "stock" && deadStockByKey[makeStockKey(row.position, row.material_code)]
                                ? "dead-stock-row"
                                : "",
                              isSharedPosition ? "shared-position-row" : "",
                              isStrongSharedPosition ? "shared-position-row-strong" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")
                          }
                        >
                          {tableConfig.columns.map((column) => {
                            const value = pickValue(row, column.keys);
                            const stockKey = makeStockKey(row.position, row.material_code);
                            const deadInfo = selectedTable === "stock" ? deadStockByKey[stockKey] : null;
                            const deadHint =
                              deadInfo && deadInfo.inactiveDays !== null
                                ? `Dead stock: bez pohybu ${deadInfo.inactiveDays} dní`
                                : deadInfo
                                  ? "Dead stock: bez záznamu pohybu"
                                  : "";
                            return (
                              <td key={`${column.label}-${row.event_key || row.position || index}`}>
                                {column.kind === "status" ? (
                                  <StatusPill status={String(value || "unknown")} />
                                ) : (
                                  <>
                                    {formatCell(value, column.kind)}
                                    {selectedTable === "stock" && column.keys.includes("position") && positionCount > 1 && (
                                      <span className="shared-position-inline" title={`Na pozícii je ${positionCount} položiek`}>
                                        {`x${positionCount}`}
                                      </span>
                                    )}
                                    {deadHint && column.keys.includes("material_code") && (
                                      <span className="dead-stock-inline" title={deadHint}>
                                        dead stock
                                      </span>
                                    )}
                                  </>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {filteredRows.length === 0 && (
              <div className="empty-state">
                <p>Pre tento filter nie sú dáta.</p>
                <button
                  type="button"
                  className="clear-btn"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("all");
                    setShowDeadStockOnly(false);
                  }}
                >
                  Resetovať filter
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {isSettingsOpen && (
        <div className="settings-backdrop" role="presentation" onClick={() => setIsSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Nastavenia monitoru"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-head">
              <h2>Nastavenia</h2>
              <button type="button" className="clear-btn" onClick={() => setIsSettingsOpen(false)}>
                Zavrieť
              </button>
            </div>

            <label className="settings-field" htmlFor="settings-dead-stock-days">
              <span>Dead stock dni</span>
              <input
                id="settings-dead-stock-days"
                type="number"
                min={1}
                max={3650}
                className="dead-stock-days-input"
                value={deadStockDays}
                onChange={(event) => setDeadStockDays(normalizeDeadStockDays(event.target.value))}
              />
            </label>

            <label className="settings-field" htmlFor="settings-max-positions">
              <span>Max počet pozícií</span>
              <input
                id="settings-max-positions"
                type="number"
                min={1}
                max={1000000}
                className="dead-stock-days-input"
                value={maxPositions}
                onChange={(event) => setMaxPositions(normalizeMaxPositions(event.target.value))}
              />
            </label>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
