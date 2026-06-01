export const DAY_MS = 24 * 60 * 60 * 1000;

export function formatMesDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const MES_BASE_LOOKBACK_DAYS = Math.max(1, Number(import.meta.env.VITE_MES_BASE_LOOKBACK_DAYS || 2));
export const MES_ANALYTICS_LOOKBACK_DAYS = Math.max(MES_BASE_LOOKBACK_DAYS, Number(import.meta.env.VITE_MES_LOOKBACK_DAYS || 30));
export const MES_THROUGHPUT_RANGE_OPTIONS = [
  { key: "last_30_minutes", label: "30 min" },
  { key: "last_8_hours", label: "8 hodín" },
  { key: "current_shift", label: "Aktuálna zmena" },
  { key: "shift_06_14", label: "Ranná smena" },
  { key: "shift_14_22", label: "Poobedná smena" },
  { key: "today", label: "Dnes" },
  { key: "yesterday", label: "Včera" },
  { key: "last_7_days", label: "7 dní" },
  { key: "custom", label: "Vlastné" }
];
export const MES_THROUGHPUT_SHIFT_RANGE_KEYS = new Set(["shift_06_14", "shift_14_22"]);

export const MES_DASHBOARD_DEFAULT_KPI_KEYS = [
  "running",
  "stopped",
  "activeOrders",
  "productionRate",
  "goodParts",
  "scrapParts",
  "onlineTerminals",
  "oee",
  "rejectRate"
];
export const MES_FACTORY_TERMINAL_GRID_ROWS = 4;
export const MES_FACTORY_TERMINAL_GRID_COLS = 6;
export const DEFAULT_MES_DASHBOARD_CUSTOMIZATION = {
  showMachineFocus: true,
  showMachineTable: true,
  showThroughputQuality: true,
  showAvailableOperators: true,
  showActiveOperators: true,
  showFactoryMap: true,
  visibleKpis: MES_DASHBOARD_DEFAULT_KPI_KEYS,
  terminalMapLayout: {}
};
