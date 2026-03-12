import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRef } from "react";
import * as XLSX from "xlsx";
import { installHotjar, uninstallHotjar } from "./hotjar";
import StatusPill from "./components/StatusPill";
import { clearSupabaseAuthStorage, noStoreFetch, supabase, supabaseAnonKey, supabaseUrl, tableNames } from "./supabaseClient";
import logo from "../logo.png";

const DAILY_OVERVIEW_TABLE = "__daily_overview__";
const ORDERS_MODULE = "__orders__";
const PRODUCTION_MODULE = "__production__";
const PRICE_LIST_TABLE = "price_list";
const COMPANY_LOOKUP_DEBOUNCE_MS = 250;

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
  [PRICE_LIST_TABLE]: {
    title: "Cenník",
    subtitle: "Jednotkové ceny materiálov podľa firmy",
    columns: [
      { label: "Materiál", keys: ["material_code"], required: true },
      { label: "Jednotka", keys: ["unit"], required: true },
      { label: "Predajná cena", keys: ["unit_price"], kind: "currency", required: true },
      { label: "Nákupná cena", keys: ["purchase_price"], kind: "currency", required: true },
      { label: "Marža", keys: ["margin_value"], kind: "currency", required: true },
      { label: "Max zľava", keys: ["max_discount_display"], required: true },
      { label: "Poznámka", keys: ["note"] },
      { label: "Upravené", keys: ["updated_at", "created_at"], kind: "date_time" }
    ],
    searchKeys: ["material_code", "unit", "note", "unit_price", "purchase_price", "max_discount_display"],
    statusKeys: [],
    timeKeys: ["updated_at", "created_at"],
    orderBy: "material_code",
    orderAsc: true,
    metricLabel: "Položky cenníka",
    metricValue: (rows) => rows.length
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
  },
  [DAILY_OVERVIEW_TABLE]: {
    title: "Denný prehľad",
    subtitle: "Manažérsky prehľad dnešného pohybu skladu",
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
    metricLabel: "Dnešné pohyby",
    metricValue: (rows) => rows.length
  },
  [ORDERS_MODULE]: {
    title: "Objednávky",
    subtitle: "Zákazníci, rozpracované objednávky a PDF výstupy",
    columns: [],
    searchKeys: [],
    statusKeys: [],
    timeKeys: [],
    orderBy: "created_at",
    orderAsc: false,
    metricLabel: "Objednávky",
    metricValue: (rows) => rows.length
  },
  [PRODUCTION_MODULE]: {
    title: "Výrobné objednávky",
    subtitle: "Interná výroba: vstupy zo skladu, výstupy na sklad",
    columns: [],
    searchKeys: [],
    statusKeys: [],
    timeKeys: [],
    orderBy: "created_at",
    orderAsc: false,
    metricLabel: "Výrobné zákazky",
    metricValue: (rows) => rows.length
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

const ROLE_TABLE = (import.meta.env.VITE_USER_ROLES_TABLE || "app_users").trim();
const MASTER_EMAIL = (import.meta.env.VITE_MASTER_EMAIL || "").trim().toLowerCase();
const INTERNAL_LOGIN_DOMAIN = (import.meta.env.VITE_INTERNAL_LOGIN_DOMAIN || "wms.local").trim().toLowerCase();
const DEFAULT_DB_URL = String(supabaseUrl || "").trim();
const DEFAULT_DB_ANON_KEY = String(supabaseAnonKey || "").trim();
const MIN_MANAGED_PASSWORD_LENGTH = 8;
const ENV_DEFAULT_DEAD_STOCK_DAYS = Math.max(1, Number(import.meta.env.VITE_DEAD_STOCK_DAYS || 30));
const ENV_DEFAULT_MAX_POSITIONS = Math.max(1, Number(import.meta.env.VITE_MAX_POSITIONS || 100));
const HISTORY_ANALYTICS_LOOKBACK_DAYS = Math.max(30, Number(import.meta.env.VITE_HISTORY_LOOKBACK_DAYS || 365));
const AUTO_REFRESH_MS = Math.max(60 * 1000, Number(import.meta.env.VITE_AUTO_REFRESH_MS || 5 * 60 * 1000));
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTH_INIT_TIMEOUT_MS = 15000;
const TRANSACTIONS_TABLE = (import.meta.env.VITE_TRANSACTIONS_TABLE || "stock_history").trim();
const TRANSACTION_TABLE_ALIASES = Array.from(
  new Set([TRANSACTIONS_TABLE, "stock_history", "stock_transactions"].filter(Boolean))
);
const ORDER_STOCK_DATALIST_ID = "orders-stock-options";
const PRODUCTION_INPUT_DATALIST_ID = "production-input-stock-options";
const PRODUCTION_OUTPUT_MATERIAL_DATALIST_ID = "production-output-material-options";
const PRODUCTION_OUTPUT_DEFAULT_POSITION = "VYROBA";
const INBOUND_ACTIONS = new Set(["RECEIVE", "MOVE", "MOVE_ALL", "ADJUST"]);
const OCCUPANCY_RANGE_CONFIG = {
  day: { label: "Deň", bucketMs: 60 * 60 * 1000, points: 24 },
  week: { label: "Týždeň", bucketMs: 24 * 60 * 60 * 1000, points: 7 },
  month: { label: "Mesiac", bucketMs: 24 * 60 * 60 * 1000, points: 30 }
};
const LANDING_FEATURES = [
  "Skladový monitoring a prehľad zásob v reálnom čase",
  "Evidencia skladových pohybov podľa akcie, pozície a materiálu",
  "Dead stock, obsadenosť skladu a rýchly export dát do Excelu",
  "QR štítky a napojenie na Traktile lokátory pre sledovanie presunov"
];
const SITE_NAME = "WMS Online";
const DEFAULT_SITE_URL = String(import.meta.env.VITE_SITE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const LANDING_TITLE = `${SITE_NAME} | Skladový monitoring a online prehľad zásob`;
const LANDING_DESCRIPTION =
  "Skladový monitoring, online prehľad zásob a evidencia skladových pohybov v reálnom čase pre výrobu, logistiku a interné sklady.";
const LANDING_USE_CASES = [
  "Sklady a logistické tímy, ktoré potrebujú online prehľad zásob podľa pozície a materiálu.",
  "Výrobné prevádzky, ktoré chcú mať evidenciu skladových pohybov bez ručných Excel reportov.",
  "Manažéri, ktorí potrebujú rýchlo vidieť dead stock, obsadenosť skladu a denný pohyb materiálu."
];
const LANDING_FAQ = [
  {
    question: "Čo dokáže WMS Online sledovať?",
    answer:
      "Aplikácia zobrazuje stav skladu, online prehľad zásob, históriu pohybov, príjmy, výdaje, presuny, obsadenosť pozícií aj dead stock v jednom rozhraní."
  },
  {
    question: "Je systém vhodný pre výrobu aj logistiku?",
    answer:
      "Áno. Je vhodný pre interné sklady, výrobu aj logistiku, kde treba mať rýchly prehľad zásob a pohybov."
  },
  {
    question: "Dá sa WMS Online napojiť na existujúce procesy?",
    answer:
      "Áno. Riešenie sa dá prispôsobiť interným skladovým procesom, QR štítkom aj lokátorom."
  }
];

function getTableConfig(table) {
  if (isOrdersModule(table)) {
    return TABLE_CONFIG[ORDERS_MODULE];
  }
  if (isProductionModule(table)) {
    return TABLE_CONFIG[PRODUCTION_MODULE];
  }
  if (isDailyOverviewTable(table)) {
    return TABLE_CONFIG[DAILY_OVERVIEW_TABLE];
  }
  if (isTransactionsTable(table)) {
    return TABLE_CONFIG.stock_history;
  }
  return TABLE_CONFIG[table] || DEFAULT_CONFIG;
}

function isOrdersModule(table) {
  return String(table || "").trim() === ORDERS_MODULE;
}

function isProductionModule(table) {
  return String(table || "").trim() === PRODUCTION_MODULE;
}

function isWorkflowModule(table) {
  return isOrdersModule(table) || isProductionModule(table);
}

function isDailyOverviewTable(table) {
  return String(table || "").trim() === DAILY_OVERVIEW_TABLE;
}

function isTransactionsTable(table) {
  return TRANSACTION_TABLE_ALIASES.includes(String(table || "").trim());
}

function getStartOfTodayMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function getTableLabel(table) {
  if (isOrdersModule(table)) {
    return "Objednávky";
  }
  if (isProductionModule(table)) {
    return "Výrobné objednávky";
  }
  if (isDailyOverviewTable(table)) {
    return "Denný prehľad";
  }
  if (String(table || "").trim() === "stock") {
    return "Sklad";
  }
  if (String(table || "").trim() === PRICE_LIST_TABLE) {
    return "Cenník";
  }
  if (isTransactionsTable(table)) {
    return "Transakcie";
  }
  return table;
}

function isCompanyScopedTable(table) {
  const normalized = String(table || "").trim();
  return normalized === "stock" || normalized === PRICE_LIST_TABLE || isTransactionsTable(normalized);
}

function makeStockKey(position, materialCode, companyId) {
  return `${String(companyId || "").trim()}::${String(position || "").trim()}::${String(materialCode || "").trim()}`;
}

function createEmptyOrderDraftItem() {
  return {
    draftId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    stockKey: "",
    stockInput: "",
    orderedQuantity: "1",
    lineNote: "",
    showNote: false
  };
}

function createEmptyProductionInputDraft() {
  return {
    draftId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    stockKey: "",
    stockInput: "",
    requiredQuantity: "1",
    lineNote: "",
    showNote: false
  };
}

function createEmptyProductionOutputDraft() {
  return {
    draftId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    materialCode: "",
    outputQuantity: "1",
    lineNote: "",
    showNote: false
  };
}

function normalizeOptionSearchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveOrderStockOption(value, options) {
  const normalizedValue = normalizeOptionSearchValue(value);
  if (!normalizedValue) {
    return null;
  }

  const exactLabelMatch = options.find((option) => normalizeOptionSearchValue(option.label) === normalizedValue);
  if (exactLabelMatch) {
    return exactLabelMatch;
  }

  const exactMaterialMatches = options.filter(
    (option) => normalizeOptionSearchValue(option.row?.material_code) === normalizedValue
  );
  if (exactMaterialMatches.length === 1) {
    return exactMaterialMatches[0];
  }

  const exactPositionMatches = options.filter((option) => normalizeOptionSearchValue(option.row?.position) === normalizedValue);
  if (exactPositionMatches.length === 1) {
    return exactPositionMatches[0];
  }

  const containsMatches = options.filter((option) => normalizeOptionSearchValue(option.label).includes(normalizedValue));
  if (containsMatches.length === 1) {
    return containsMatches[0];
  }

  return null;
}

function buildCustomerNotePayload(note, registryMeta) {
  const metadataParts = [];
  if (registryMeta?.ico) {
    metadataParts.push(`ICO: ${registryMeta.ico}`);
  }
  if (registryMeta?.dic) {
    metadataParts.push(`DIC: ${registryMeta.dic}`);
  }
  if (registryMeta?.source) {
    metadataParts.push(`Zdroj: ${registryMeta.source}`);
  }

  const noteLines = [];
  if (metadataParts.length > 0) {
    noteLines.push(metadataParts.join(" | "));
  }

  const trimmedNote = String(note || "").trim();
  if (trimmedNote) {
    noteLines.push(trimmedNote);
  }

  return noteLines.join("\n");
}

function makeMaterialSubscriptionKey(companyId, materialCode) {
  return `${String(companyId || "").trim()}::${String(materialCode || "").trim()}`;
}

function columnLabelFromIndex(index) {
  let current = Math.max(0, Number(index || 0));
  let label = "";

  do {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);

  return label;
}

function buildRackLocationCodes(rackPrefix, rowCount, columnCount) {
  const normalizedPrefix = String(rackPrefix || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const rows = Math.max(1, Number.parseInt(String(rowCount || "1"), 10) || 1);
  const columns = Math.max(1, Number.parseInt(String(columnCount || "1"), 10) || 1);
  const codes = [];

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      codes.push(`${normalizedPrefix}${row}${columnLabelFromIndex(column)}`);
    }
  }

  return codes;
}

function buildQrImageUrl(value, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
}

function resolvePrintableAssetUrl(assetUrl) {
  const raw = String(assetUrl || "").trim();
  if (!raw || typeof window === "undefined") {
    return "";
  }

  try {
    return new URL(raw, window.location.href).href;
  } catch {
    return raw;
  }
}

function buildQrLabelsPrintHtml(codes, logoUrl) {
  const generatedAt = new Date().toLocaleString("sk-SK");
  const labelsHtml = codes
    .map(
      (code) => `
        <article class="label">
          <div class="qr-wrap">
            <img class="qr-image" src="${buildQrImageUrl(code)}" alt="QR ${escapeHtml(code)}" />
          </div>
          ${
            logoUrl
              ? `<span class="label-logo-corner"><img class="label-logo" src="${escapeHtml(logoUrl)}" alt="Logo" /></span>`
              : ""
          }
          <strong>${escapeHtml(code)}</strong>
        </article>
      `
    )
    .join("");

  return `<!doctype html>
  <html lang="sk">
    <head>
      <meta charset="UTF-8" />
      <title>QR štítky skladu</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 8mm;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          font-family: Arial, sans-serif;
          color: #1b2631;
        }

        .sheet-head {
          margin: 0 0 6mm;
          display: flex;
          justify-content: space-between;
          gap: 4mm;
          align-items: end;
        }

        .sheet-head h1 {
          margin: 0;
          font-size: 14pt;
        }

        .sheet-head p {
          margin: 1mm 0 0;
          font-size: 8pt;
          color: #51606f;
        }

        .labels {
          display: grid;
          grid-template-columns: repeat(auto-fill, 40mm);
          gap: 3mm;
          justify-content: start;
        }

        .label {
          position: relative;
          width: 40mm;
          height: 40mm;
          border: 0.2mm solid #d9e2ec;
          border-radius: 1.5mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 1.5mm;
          overflow: hidden;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .qr-wrap {
          position: relative;
          width: 28mm;
          height: 28mm;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .qr-image {
          width: 28mm;
          height: 28mm;
          display: block;
        }

        .label-logo-corner {
          position: absolute;
          left: 1.8mm;
          bottom: 1.8mm;
          width: 5.2mm;
          height: 5.2mm;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          border-radius: 1.2mm;
          padding: 0.45mm;
          box-shadow: 0 0 0 0.45mm #ffffff;
        }

        .label-logo {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }

        .label strong {
          display: block;
          margin-top: 1.2mm;
          font-size: 10pt;
          letter-spacing: 0.3mm;
        }
      </style>
    </head>
    <body>
      <section class="sheet-head">
        <div>
          <h1>QR štítky skladu</h1>
          <p>Vygenerované: ${escapeHtml(generatedAt)}</p>
        </div>
        <p>${escapeHtml(`Počet štítkov: ${codes.length}`)}</p>
      </section>
      <section class="labels">
        ${labelsHtml}
      </section>
    </body>
  </html>`;
}

function printQrLabels(codes, logoUrl) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Tlač QR štítkov je dostupná len v prehliadači.");
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";

  const cleanup = () => {
    window.setTimeout(() => {
      frame.remove();
    }, 1000);
  };

  frame.onload = () => {
    const targetWindow = frame.contentWindow;
    if (!targetWindow) {
      cleanup();
      return;
    }

    const handleAfterPrint = () => {
      targetWindow.removeEventListener("afterprint", handleAfterPrint);
      cleanup();
    };

    targetWindow.addEventListener("afterprint", handleAfterPrint);
    window.setTimeout(() => {
      try {
        targetWindow.focus();
        targetWindow.print();
      } catch {
        cleanup();
      }
    }, 150);
  };

  document.body.appendChild(frame);
  frame.srcdoc = buildQrLabelsPrintHtml(codes, logoUrl);
}

function downloadQrLabelsHtml(codes, logoUrl) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Export QR štítkov je dostupný len v prehliadači.");
  }

  const html = buildQrLabelsPrintHtml(codes, logoUrl);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `qr-labels-${timestamp}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function printHtmlDocument(html) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Tlač je dostupná len v prehliadači.");
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";

  const cleanup = () => {
    window.setTimeout(() => {
      frame.remove();
    }, 1000);
  };

  frame.onload = () => {
    const targetWindow = frame.contentWindow;
    if (!targetWindow) {
      cleanup();
      return;
    }

    const handleAfterPrint = () => {
      targetWindow.removeEventListener("afterprint", handleAfterPrint);
      cleanup();
    };

    targetWindow.addEventListener("afterprint", handleAfterPrint);
    window.setTimeout(() => {
      try {
        targetWindow.focus();
        targetWindow.print();
      } catch {
        cleanup();
      }
    }, 150);
  };

  document.body.appendChild(frame);
  frame.srcdoc = html;
}

function buildOrderNumber() {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `OBJ-${datePart}-${timePart}-${randomPart}`;
}

function buildProductionNumber() {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `VYR-${datePart}-${timePart}-${randomPart}`;
}

function buildInventoryEventKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildOrderIdentityQrPayload(order) {
  return JSON.stringify(
    {
      t: "wms_order",
      id: String(order?.id || ""),
      no: String(order?.order_number || "")
    },
    null,
    0
  );
}

function buildOrderItemsQrPayload(order, items) {
  return JSON.stringify(
    {
      t: "wms_order_items",
      id: String(order?.id || ""),
      no: String(order?.order_number || ""),
      it: (items || []).map((item) => ({
        m: String(item?.material_code || ""),
        p: String(item?.position || ""),
        q: Number(item?.ordered_quantity || 0),
        n: String(item?.line_note || "")
      }))
    },
    null,
    0
  );
}

function buildOrderPrintHtml(order, customer, items, companyName) {
  const generatedAt = new Date().toLocaleString("sk-SK");
  const createdAt = formatDate(order?.created_at);
  const customerName = String(order?.customer_name || customer?.name || "-");
  const orderNote = String(order?.note || "").trim();
  const orderIdentityQr = buildQrImageUrl(buildOrderIdentityQrPayload(order), 180);
  const orderItemsQr = buildQrImageUrl(buildOrderItemsQrPayload(order, items), 180);
  const noteHtml = orderNote
    ? `
        <section class="note">
          <span class="label">Poznámka k objednávke</span>
          <div>${escapeHtml(orderNote)}</div>
        </section>
      `
    : "";
  const rowsHtml = (items || [])
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(String(item.material_code || "-"))}</td>
          <td>${escapeHtml(String(item.position || "-"))}</td>
          <td>${escapeHtml(formatCell(item.ordered_quantity, "number"))}</td>
          <td>${escapeHtml(formatCell(item.stock_quantity_snapshot, "number"))}</td>
          <td>${escapeHtml(String(item.line_note || "-"))}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
  <html lang="sk">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(String(order?.order_number || "Objednavka"))}</title>
      <style>
        @page { size: A4 portrait; margin: 14mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; color: #1b2631; }
        .page { display: grid; gap: 8mm; }
        .head { display: flex; justify-content: space-between; gap: 8mm; align-items: start; }
        h1 { margin: 0 0 2mm; font-size: 20pt; }
        .meta, .customer, .note, .qr-section { border: 0.3mm solid #d9e2ec; border-radius: 3mm; padding: 4mm; }
        .meta-grid, .customer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3mm 6mm; }
        .label { display: block; margin-bottom: 1mm; font-size: 8pt; color: #52606d; text-transform: uppercase; letter-spacing: 0.08em; }
        .value { font-size: 11pt; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; font-size: 10pt; }
        th, td { border: 0.3mm solid #d9e2ec; padding: 3mm; text-align: left; vertical-align: top; }
        th { background: #eef4f8; }
        .qr-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5mm; }
        .qr-card { display: grid; gap: 2mm; justify-items: center; text-align: center; }
        .qr-card img { width: 36mm; height: 36mm; display: block; }
        .qr-caption { font-size: 9pt; font-weight: 700; }
        .qr-hint { font-size: 8pt; color: #52606d; }
        .foot { font-size: 8pt; color: #52606d; }
      </style>
    </head>
    <body>
      <section class="page">
        <header class="head">
          <div>
            <h1>Objednávka</h1>
            <div class="value">${escapeHtml(String(order?.order_number || "-"))}</div>
          </div>
          <div class="foot">Vygenerované: ${escapeHtml(generatedAt)}</div>
        </header>
        <section class="meta">
          <div class="meta-grid">
            <div><span class="label">Firma</span><div class="value">${escapeHtml(String(companyName || "-"))}</div></div>
            <div><span class="label">Vytvorené</span><div class="value">${escapeHtml(createdAt)}</div></div>
            <div><span class="label">ID objednávky</span><div class="value">${escapeHtml(String(order?.id || "-"))}</div></div>
            <div><span class="label">Číslo objednávky</span><div class="value">${escapeHtml(String(order?.order_number || "-"))}</div></div>
          </div>
        </section>
        <section class="customer">
          <div class="customer-grid">
            <div><span class="label">Zákazník</span><div class="value">${escapeHtml(customerName)}</div></div>
            <div><span class="label">Telefón</span><div class="value">${escapeHtml(String(customer?.phone || "-"))}</div></div>
            <div><span class="label">Email</span><div class="value">${escapeHtml(String(customer?.email || "-"))}</div></div>
            <div><span class="label">Adresa</span><div class="value">${escapeHtml(String(customer?.address || "-"))}</div></div>
          </div>
        </section>
        <section>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Materiál</th>
                <th>Pozícia</th>
                <th>Objednané</th>
                <th>Sklad pri vytvorení</th>
                <th>Poznámka</th>
              </tr>
            </thead>
            <tbody>${rowsHtml || '<tr><td colspan="6">Objednávka nemá položky.</td></tr>'}</tbody>
          </table>
        </section>
        <section class="qr-section">
          <div class="qr-grid">
            <article class="qr-card">
              <span class="qr-caption">QR: ID objednávky</span>
              <img src="${orderIdentityQr}" alt="QR ID objednávky" />
              <div class="qr-hint">${escapeHtml(String(order?.id || "-"))}</div>
            </article>
            <article class="qr-card">
              <span class="qr-caption">QR: ID a položky objednávky</span>
              <img src="${orderItemsQr}" alt="QR ID a položky objednávky" />
              <div class="qr-hint">Obsahuje ID, číslo objednávky a položky</div>
            </article>
          </div>
        </section>
        ${noteHtml}
      </section>
    </body>
  </html>`;
}

function printOrderPdf(order, customer, items, companyName) {
  printHtmlDocument(buildOrderPrintHtml(order, customer, items, companyName));
}

function buildProductionPrintHtml(productionOrder, inputs, outputs, companyName) {
  const generatedAt = new Date().toLocaleString("sk-SK");
  const createdAt = formatDate(productionOrder?.created_at);
  const completedAt = productionOrder?.completed_at ? formatDate(productionOrder.completed_at) : "-";
  const productionNote = String(productionOrder?.note || "").trim();
  const noteHtml = productionNote
    ? `
        <section class="note">
          <span class="label">Poznámka</span>
          <div>${escapeHtml(productionNote)}</div>
        </section>
      `
    : "";
  const inputRowsHtml = (inputs || [])
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(String(item.material_code || "-"))}</td>
          <td>${escapeHtml(String(item.position || "-"))}</td>
          <td>${escapeHtml(formatCell(item.required_quantity, "number"))}</td>
          <td>${escapeHtml(String(item.line_note || "-"))}</td>
        </tr>
      `
    )
    .join("");
  const outputRowsHtml = (outputs || [])
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(String(item.material_code || "-"))}</td>
          <td>${escapeHtml(formatCell(item.output_quantity, "number"))}</td>
          <td>${escapeHtml(String(item.line_note || "-"))}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
  <html lang="sk">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(String(productionOrder?.production_number || "Vyrobna-objednavka"))}</title>
      <style>
        @page { size: A4 portrait; margin: 14mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; color: #1b2631; }
        .page { display: grid; gap: 8mm; }
        .head { display: flex; justify-content: space-between; gap: 8mm; align-items: start; }
        h1 { margin: 0 0 2mm; font-size: 20pt; }
        .meta, .note, .section-box { border: 0.3mm solid #d9e2ec; border-radius: 3mm; padding: 4mm; }
        .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3mm 6mm; }
        .label { display: block; margin-bottom: 1mm; font-size: 8pt; color: #52606d; text-transform: uppercase; letter-spacing: 0.08em; }
        .value { font-size: 11pt; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; font-size: 10pt; }
        th, td { border: 0.3mm solid #d9e2ec; padding: 3mm; text-align: left; vertical-align: top; }
        th { background: #eef4f8; }
        .section-title { margin: 0 0 3mm; font-size: 12pt; }
        .foot { font-size: 8pt; color: #52606d; }
      </style>
    </head>
    <body>
      <section class="page">
        <header class="head">
          <div>
            <h1>Výrobná objednávka</h1>
            <div class="value">${escapeHtml(String(productionOrder?.production_number || "-"))}</div>
          </div>
          <div class="foot">Vygenerované: ${escapeHtml(generatedAt)}</div>
        </header>
        <section class="meta">
          <div class="meta-grid">
            <div><span class="label">Firma</span><div class="value">${escapeHtml(String(companyName || "-"))}</div></div>
            <div><span class="label">Názov</span><div class="value">${escapeHtml(String(productionOrder?.title || "-"))}</div></div>
            <div><span class="label">Vytvorené</span><div class="value">${escapeHtml(createdAt)}</div></div>
            <div><span class="label">Dokončené</span><div class="value">${escapeHtml(completedAt)}</div></div>
            <div><span class="label">Stav</span><div class="value">${escapeHtml(String(productionOrder?.status || "-"))}</div></div>
            <div><span class="label">ID</span><div class="value">${escapeHtml(String(productionOrder?.id || "-"))}</div></div>
          </div>
        </section>
        ${noteHtml}
        <section class="section-box">
          <h2 class="section-title">Vstupy</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Materiál</th>
                <th>Pozícia</th>
                <th>Množstvo</th>
                <th>Poznámka</th>
              </tr>
            </thead>
            <tbody>
              ${inputRowsHtml || '<tr><td colspan="5">Bez vstupov</td></tr>'}
            </tbody>
          </table>
        </section>
        <section class="section-box">
          <h2 class="section-title">Výstupy</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Materiál</th>
                <th>Množstvo</th>
                <th>Poznámka</th>
              </tr>
            </thead>
            <tbody>
              ${outputRowsHtml || '<tr><td colspan="4">Bez výstupov</td></tr>'}
            </tbody>
          </table>
        </section>
      </section>
    </body>
  </html>`;
}

function printProductionPdf(productionOrder, inputs, outputs, companyName) {
  printHtmlDocument(buildProductionPrintHtml(productionOrder, inputs, outputs, companyName));
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

function normalizeUsernameInput(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function buildInternalEmailFromUsername(username) {
  const normalized = normalizeUsernameInput(username);
  if (!normalized) {
    return "";
  }
  return `${normalized}@${INTERNAL_LOGIN_DOMAIN}`;
}

function usernameFromInternalEmail(emailValue) {
  const email = String(emailValue || "").toLowerCase();
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) {
    return "";
  }
  return normalizeUsernameInput(email.slice(0, atIndex));
}

function resolveLoginEmail(loginValue) {
  const raw = String(loginValue || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw.includes("@")) {
    return raw;
  }
  return buildInternalEmailFromUsername(raw);
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

function formatCurrencyValue(value) {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatPercentValue(value, maximumFractionDigits = 1) {
  return `${new Intl.NumberFormat("sk-SK", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(Number(value))} %`;
}

function buildPriceListComputedRow(row) {
  const salePrice = Number(row?.unit_price || 0);
  const purchasePrice = Number(row?.purchase_price || 0);
  const marginValue = Math.round((salePrice - purchasePrice) * 100) / 100;
  const maxDiscountValue = Math.max(0, marginValue);
  const maxDiscountPercent = salePrice > 0 ? (maxDiscountValue / salePrice) * 100 : 0;

  return {
    ...row,
    margin_value: marginValue,
    margin_percent: salePrice > 0 ? (marginValue / salePrice) * 100 : 0,
    max_discount_value: maxDiscountValue,
    max_discount_percent: maxDiscountPercent,
    max_discount_display: `${formatCurrencyValue(maxDiscountValue)} | ${formatPercentValue(maxDiscountPercent)}`
  };
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

  if (kind === "date") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return parsed.toLocaleDateString("sk-SK");
  }

  if (kind === "date_time") {
    return formatDate(value);
  }

  if (kind === "currency") {
    return formatCurrencyValue(value);
  }

  return String(value);
}

function normalizePriceInput(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function normalizeImportHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolvePriceListImportColumn(headers, aliases) {
  for (const alias of aliases) {
    const match = headers.find((header) => normalizeImportHeader(header) === alias);
    if (match) {
      return match;
    }
  }
  return "";
}

async function readSpreadsheetRows(file) {
  const fileName = String(file?.name || "").toLowerCase();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    raw: false,
    dense: false,
    codepage: 65001,
    WTF: false
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Súbor neobsahuje žiadny hárok.");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("Nepodarilo sa načítať prvý hárok zo súboru.");
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
    blankrows: false
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      fileName.endsWith(".csv")
        ? "CSV súbor je prázdny alebo nemá hlavičku."
        : "Súbor je prázdny alebo neobsahuje tabuľkové dáta."
    );
  }

  return rows;
}

function normalizeForSearch(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s\-_/.]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolveSiteUrl() {
  if (DEFAULT_SITE_URL) {
    return DEFAULT_SITE_URL;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

function upsertMetaTag(attributeName, attributeValue, content) {
  if (typeof document === "undefined") {
    return;
  }

  let tag = document.head.querySelector(`meta[${attributeName}="${attributeValue}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attributeName, attributeValue);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertLinkTag(rel, href) {
  if (typeof document === "undefined") {
    return;
  }

  let tag = document.head.querySelector(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.setAttribute("rel", rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute("href", href);
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
}

function isRecoverableAuthStateError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "refresh token",
    "invalid refresh token",
    "jwt",
    "session",
    "storage",
    "json",
    "auth session missing"
  ].some((fragment) => message.includes(fragment));
}

function decodeJwtClaims(accessToken) {
  try {
    const token = String(accessToken || "");
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }
    const base64Url = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function movementDeltaFromAction(action) {
  const normalized = String(action || "").toUpperCase();
  if (normalized === "RECEIVE") {
    return 1;
  }
  if (normalized === "ISSUE") {
    return -1;
  }
  return 0;
}

function buildOccupancySeries(historyRows, options) {
  const { range = "week", maxPositions = 1, isMaster = false, selectedCompanyId = "all" } = options;
  const cfg = OCCUPANCY_RANGE_CONFIG[range] || OCCUPANCY_RANGE_CONFIG.week;
  const now = Date.now();
  const windowStart = now - (cfg.points - 1) * cfg.bucketMs;
  const rows = [...(historyRows || [])]
    .filter((row) => Number.isFinite(Number(row.created_at_ms)))
    .sort((a, b) => Number(a.created_at_ms) - Number(b.created_at_ms));

  const qtyByMaterialKey = new Map();
  const activeMaterialsPerPosition = new Map();
  let occupiedPositions = 0;

  const positionKeyForRow = (row) => {
    const position = String(row.position || "").trim();
    if (!position) {
      return "";
    }
    const includeCompany = isMaster && selectedCompanyId === "all";
    return includeCompany ? `${String(row.company_id || "").trim()}::${position}` : position;
  };

  const materialKeyForRow = (row) => {
    const positionKey = positionKeyForRow(row);
    const material = String(row.material_code || "").trim();
    if (!positionKey || !material) {
      return "";
    }
    return `${positionKey}::${material}`;
  };

  const applyEvent = (row) => {
    const delta = movementDeltaFromAction(row.action);
    if (delta === 0) {
      return;
    }

    const positionKey = positionKeyForRow(row);
    const materialKey = materialKeyForRow(row);
    if (!positionKey || !materialKey) {
      return;
    }

    const prevQty = qtyByMaterialKey.get(materialKey) || 0;
    const nextQty = Math.max(0, prevQty + delta);
    const positionMaterialCount = activeMaterialsPerPosition.get(positionKey) || 0;

    if (prevQty <= 0 && nextQty > 0) {
      const nextCount = positionMaterialCount + 1;
      activeMaterialsPerPosition.set(positionKey, nextCount);
      if (positionMaterialCount === 0) {
        occupiedPositions += 1;
      }
    } else if (prevQty > 0 && nextQty <= 0) {
      const nextCount = Math.max(0, positionMaterialCount - 1);
      if (nextCount === 0) {
        activeMaterialsPerPosition.delete(positionKey);
        occupiedPositions = Math.max(0, occupiedPositions - 1);
      } else {
        activeMaterialsPerPosition.set(positionKey, nextCount);
      }
    }

    if (nextQty <= 0) {
      qtyByMaterialKey.delete(materialKey);
    } else {
      qtyByMaterialKey.set(materialKey, nextQty);
    }
  };

  let eventIndex = 0;
  const denominator = Math.max(1, Number(maxPositions || 1));
  const series = [];
  for (let i = 0; i < cfg.points; i += 1) {
    const bucketTs = windowStart + i * cfg.bucketMs;
    while (eventIndex < rows.length && Number(rows[eventIndex].created_at_ms) <= bucketTs) {
      applyEvent(rows[eventIndex]);
      eventIndex += 1;
    }

    const percent = (occupiedPositions / denominator) * 100;
    const date = new Date(bucketTs);
    const label =
      range === "day"
        ? date.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" })
        : date.toLocaleDateString("sk-SK", { day: "2-digit", month: "2-digit" });
    series.push({ ts: bucketTs, label, percent, occupied: occupiedPositions });
  }

  return series;
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

function maskSecret(value) {
  const raw = String(value || "");
  if (!raw) {
    return "-";
  }
  if (raw.length <= 10) {
    return raw;
  }
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function normalizePositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

function App() {
  const [selectedTable, setSelectedTable] = useState(tableNames[0]);
  const [rows, setRows] = useState([]);
  const [stockViewMode, setStockViewMode] = useState("table");
  const [expandedPositions, setExpandedPositions] = useState({});
  const [deadStockByKey, setDeadStockByKey] = useState({});
  const [stockAgeStats, setStockAgeStats] = useState({ avgDays: null, sampleCount: 0 });
  const [stockSnapshotRows, setStockSnapshotRows] = useState([]);
  const [showDeadStockOnly, setShowDeadStockOnly] = useState(false);
  const [deadStockDays, setDeadStockDays] = useState(() => {
    const saved = window.localStorage.getItem("wms_dead_stock_days");
    return normalizeDeadStockDays(saved ?? ENV_DEFAULT_DEAD_STOCK_DAYS);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authInitTimedOut, setAuthInitTimedOut] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authUsername, setAuthUsername] = useState("");
  const [userRole, setUserRole] = useState("user");
  const [userCompanyId, setUserCompanyId] = useState(null);
  const [canManageOrders, setCanManageOrders] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [companiesError, setCompaniesError] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("all");
  const [authUsernameInput, setAuthUsernameInput] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [signOutSubmitting, setSignOutSubmitting] = useState(false);
  const [managedUsers, setManagedUsers] = useState([]);
  const [managedUsersLoading, setManagedUsersLoading] = useState(false);
  const [managedUsersError, setManagedUsersError] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("user");
  const [newUserCompanyId, setNewUserCompanyId] = useState("");
  const [newUserCanManageOrders, setNewUserCanManageOrders] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyTracksExpiryDate, setNewCompanyTracksExpiryDate] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState("");
  const [editingCompanyName, setEditingCompanyName] = useState("");
  const [editingCompanyTracksExpiryDate, setEditingCompanyTracksExpiryDate] = useState(false);
  const [createCompanySubmitting, setCreateCompanySubmitting] = useState(false);
  const [updateCompanySubmitting, setUpdateCompanySubmitting] = useState(false);
  const [deleteCompanySubmitting, setDeleteCompanySubmitting] = useState(false);
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false);
  const [repairUsersSubmitting, setRepairUsersSubmitting] = useState(false);
  const [deleteUserSubmitting, setDeleteUserSubmitting] = useState(false);
  const [masterUserSearch, setMasterUserSearch] = useState("");
  const [masterUserCompanyFilter, setMasterUserCompanyFilter] = useState("all");
  const [occupancyChartRange, setOccupancyChartRange] = useState("week");
  const [occupancySeries, setOccupancySeries] = useState([]);
  const [isCompanySettingsOpen, setIsCompanySettingsOpen] = useState(false);
  const [companyMaxPositionsInput, setCompanyMaxPositionsInput] = useState(String(ENV_DEFAULT_MAX_POSITIONS));
  const [companyTracksExpiryDateInput, setCompanyTracksExpiryDateInput] = useState(false);
  const [companySettingsSubmitting, setCompanySettingsSubmitting] = useState(false);
  const [companySettingsError, setCompanySettingsError] = useState("");
  const [qrRackPrefix, setQrRackPrefix] = useState("A");
  const [qrRowCount, setQrRowCount] = useState("1");
  const [qrColumnCount, setQrColumnCount] = useState("1");
  const [qrGeneratorError, setQrGeneratorError] = useState("");
  const [pricingEmployeeCount, setPricingEmployeeCount] = useState("150");
  const [pricingUserCount, setPricingUserCount] = useState("12");
  const [pricingWarehouseCount, setPricingWarehouseCount] = useState("1");
  const [pricingNeedsCustomSupport, setPricingNeedsCustomSupport] = useState(false);
  const [materialSubscriptions, setMaterialSubscriptions] = useState([]);
  const [materialSubscriptionsError, setMaterialSubscriptionsError] = useState("");
  const [materialSubscriptionSavingKey, setMaterialSubscriptionSavingKey] = useState("");
  const [subscriptionMaterialInput, setSubscriptionMaterialInput] = useState("");
  const [subscriptionEmailInput, setSubscriptionEmailInput] = useState("");
  const [isMaterialSubscriptionOpen, setIsMaterialSubscriptionOpen] = useState(false);
  const [priceListMaterialInput, setPriceListMaterialInput] = useState("");
  const [priceListUnitInput, setPriceListUnitInput] = useState("ks");
  const [priceListValueInput, setPriceListValueInput] = useState("");
  const [priceListPurchaseInput, setPriceListPurchaseInput] = useState("");
  const [priceListNoteInput, setPriceListNoteInput] = useState("");
  const [priceListSubmitting, setPriceListSubmitting] = useState(false);
  const [priceListDeleting, setPriceListDeleting] = useState(false);
  const [priceListImportSubmitting, setPriceListImportSubmitting] = useState(false);
  const [priceListImportResult, setPriceListImportResult] = useState("");
  const [priceListFormError, setPriceListFormError] = useState("");
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [orderItems, setOrderItems] = useState([]);
  const [ordersStockRows, setOrdersStockRows] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [customerNameInput, setCustomerNameInput] = useState("");
  const [customerEmailInput, setCustomerEmailInput] = useState("");
  const [customerPhoneInput, setCustomerPhoneInput] = useState("");
  const [customerAddressInput, setCustomerAddressInput] = useState("");
  const [customerIcoInput, setCustomerIcoInput] = useState("");
  const [customerDicInput, setCustomerDicInput] = useState("");
  const [customerNoteInput, setCustomerNoteInput] = useState("");
  const [companyLookupResults, setCompanyLookupResults] = useState([]);
  const [companyLookupLoading, setCompanyLookupLoading] = useState(false);
  const [companyLookupError, setCompanyLookupError] = useState("");
  const [selectedRegistryCompanyId, setSelectedRegistryCompanyId] = useState("");
  const [customerSubmitting, setCustomerSubmitting] = useState(false);
  const [selectedOrderCustomerId, setSelectedOrderCustomerId] = useState("");
  const [orderSearchTerm, setOrderSearchTerm] = useState("");
  const [orderDraftItems, setOrderDraftItems] = useState([createEmptyOrderDraftItem()]);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState({});
  const [productionOrders, setProductionOrders] = useState([]);
  const [productionOrderInputs, setProductionOrderInputs] = useState([]);
  const [productionOrderOutputs, setProductionOrderOutputs] = useState([]);
  const [productionStockRows, setProductionStockRows] = useState([]);
  const [productionLoading, setProductionLoading] = useState(false);
  const [productionError, setProductionError] = useState("");
  const [productionTitleInput, setProductionTitleInput] = useState("");
  const [productionSearchTerm, setProductionSearchTerm] = useState("");
  const [productionDraftInputs, setProductionDraftInputs] = useState([createEmptyProductionInputDraft()]);
  const [productionDraftOutputs, setProductionDraftOutputs] = useState([createEmptyProductionOutputDraft()]);
  const [productionSubmitting, setProductionSubmitting] = useState(false);
  const [productionCompletingId, setProductionCompletingId] = useState("");
  const [expandedProductionOrders, setExpandedProductionOrders] = useState({});
  const latestLoadRowsRequestRef = useRef(0);
  const companyLookupRequestRef = useRef(0);
  const priceListImportInputRef = useRef(null);

  const tableConfig = getTableConfig(selectedTable);
  const isMaster = userRole === "master";
  const canAccessOrdersModule = isMaster || canManageOrders;
  const hotjarAllowed = (authReady || authInitTimedOut) && (!isLoggedIn || !isMaster);
  const visibleTableNames = useMemo(() => {
    if (isMaster) {
      return Array.from(new Set([...tableNames, PRICE_LIST_TABLE, ORDERS_MODULE, PRODUCTION_MODULE]));
    }
    const baseTables = Array.from(
      new Set([DAILY_OVERVIEW_TABLE, PRICE_LIST_TABLE, ...tableNames.filter((table) => table === "stock" || isTransactionsTable(table))])
    );
    return canAccessOrdersModule ? [...baseTables, ORDERS_MODULE, PRODUCTION_MODULE] : baseTables;
  }, [isMaster, canAccessOrdersModule]);
  const companyNameById = useMemo(
    () =>
      Object.fromEntries(
        companies.map((company) => [company.id, company.name])
      ),
    [companies]
  );
  const activeCompanyId = isMaster ? (selectedCompanyId === "all" ? null : selectedCompanyId) : userCompanyId;
  const activeCompany = useMemo(
    () => companies.find((company) => company.id === activeCompanyId) || null,
    [companies, activeCompanyId]
  );
  const customersById = useMemo(
    () => Object.fromEntries(customers.map((customer) => [customer.id, customer])),
    [customers]
  );
  const orderItemsByOrderId = useMemo(() => {
    const grouped = {};
    for (const item of orderItems) {
      const orderId = String(item.order_id || "");
      if (!grouped[orderId]) {
        grouped[orderId] = [];
      }
      grouped[orderId].push(item);
    }
    return grouped;
  }, [orderItems]);
  const productionInputsByOrderId = useMemo(() => {
    const grouped = {};
    for (const item of productionOrderInputs) {
      const orderId = String(item.production_order_id || "");
      if (!grouped[orderId]) {
        grouped[orderId] = [];
      }
      grouped[orderId].push(item);
    }
    return grouped;
  }, [productionOrderInputs]);
  const productionOutputsByOrderId = useMemo(() => {
    const grouped = {};
    for (const item of productionOrderOutputs) {
      const orderId = String(item.production_order_id || "");
      if (!grouped[orderId]) {
        grouped[orderId] = [];
      }
      grouped[orderId].push(item);
    }
    return grouped;
  }, [productionOrderOutputs]);
  const ordersStockOptions = useMemo(
    () =>
      ordersStockRows
        .filter((row) => Number(row.quantity || 0) > 0)
        .map((row) => ({
          stockKey: makeStockKey(row.position, row.material_code, row.company_id),
          row,
          label: `${String(row.material_code || "-")} | ${String(row.position || "-")} | ${new Intl.NumberFormat("sk-SK").format(Number(row.quantity || 0))} ks`
        })),
    [ordersStockRows]
  );
  const ordersStockMap = useMemo(
    () => Object.fromEntries(ordersStockOptions.map((item) => [item.stockKey, item.row])),
    [ordersStockOptions]
  );
  const productionStockOptions = useMemo(
    () =>
      productionStockRows
        .filter((row) => Number(row.quantity || 0) > 0)
        .map((row) => ({
          stockKey: makeStockKey(row.position, row.material_code, row.company_id),
          row,
          label: `${String(row.material_code || "-")} | ${String(row.position || "-")} | ${new Intl.NumberFormat("sk-SK").format(Number(row.quantity || 0))} ks`
        })),
    [productionStockRows]
  );
  const productionStockMap = useMemo(
    () => Object.fromEntries(productionStockOptions.map((item) => [item.stockKey, item.row])),
    [productionStockOptions]
  );
  const productionOutputMaterialOptions = useMemo(
    () =>
      Array.from(new Set(productionStockRows.map((row) => String(row.material_code || "").trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "sk-SK", { sensitivity: "base" })
      ),
    [productionStockRows]
  );
  const priceListRowsByMaterial = useMemo(() => {
    const map = {};
    for (const row of rows) {
      const key = normalizeOptionSearchValue(row.material_code);
      if (key) {
        map[key] = row;
      }
    }
    return map;
  }, [rows]);
  const selectedPriceListRow = useMemo(
    () => priceListRowsByMaterial[normalizeOptionSearchValue(priceListMaterialInput)] || null,
    [priceListRowsByMaterial, priceListMaterialInput]
  );
  const priceListPreview = useMemo(() => {
    const salePrice = normalizePriceInput(priceListValueInput);
    const purchasePrice = normalizePriceInput(priceListPurchaseInput);
    const safeSalePrice = salePrice ?? 0;
    const safePurchasePrice = purchasePrice ?? 0;
    const marginValue = Math.round((safeSalePrice - safePurchasePrice) * 100) / 100;
    const maxDiscountValue = Math.max(0, marginValue);
    const maxDiscountPercent = safeSalePrice > 0 ? (maxDiscountValue / safeSalePrice) * 100 : 0;

    return {
      salePrice: safeSalePrice,
      purchasePrice: safePurchasePrice,
      marginValue,
      maxDiscountValue,
      maxDiscountPercent,
      hasValidSalePrice: salePrice !== null,
      hasValidPurchasePrice: purchasePrice !== null
    };
  }, [priceListValueInput, priceListPurchaseInput]);
  const priceListMaterialSuggestions = useMemo(
    () =>
      Array.from(
        new Set(
          [...rows, ...stockSnapshotRows]
            .map((row) => String(row.material_code || "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "sk-SK", { sensitivity: "base" })),
    [rows, stockSnapshotRows]
  );
  const showsExpiryDate = selectedTable === "stock" && Boolean(activeCompany?.tracks_expiry_date);
  const effectiveTableConfig = useMemo(() => {
    if (!showsExpiryDate) {
      return tableConfig;
    }

    if (selectedTable !== "stock") {
      return tableConfig;
    }

    return {
      ...tableConfig,
      columns: [
        ...tableConfig.columns,
        { label: "Dátum spotreby", keys: ["expiry_date"], kind: "date" }
      ],
      searchKeys: [...tableConfig.searchKeys, "expiry_date"]
    };
  }, [tableConfig, selectedTable, showsExpiryDate]);
  const materialSubscriptionsByKey = useMemo(() => {
    const grouped = {};
    for (const item of materialSubscriptions) {
      const key = makeMaterialSubscriptionKey(item.company_id, item.material_code);
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
    }
    return grouped;
  }, [materialSubscriptions]);
  const effectiveMaxPositions = useMemo(() => {
    if (selectedTable !== "stock") {
      return ENV_DEFAULT_MAX_POSITIONS;
    }
    if (isMaster && selectedCompanyId === "all") {
      const totalCapacity = companies.reduce(
        (sum, company) => sum + normalizeMaxPositions(company.max_positions ?? ENV_DEFAULT_MAX_POSITIONS),
        0
      );
      return Math.max(1, totalCapacity || ENV_DEFAULT_MAX_POSITIONS);
    }
    return normalizeMaxPositions(activeCompany?.max_positions ?? ENV_DEFAULT_MAX_POSITIONS);
  }, [selectedTable, isMaster, selectedCompanyId, companies, activeCompany]);
  const pricingEstimate = useMemo(() => {
    const employees = normalizePositiveInt(pricingEmployeeCount, 0);
    const users = Math.max(1, normalizePositiveInt(pricingUserCount, 1));
    const warehouses = Math.max(1, normalizePositiveInt(pricingWarehouseCount, 1));

    let monthly = 90;
    let setup = 900;

    if (employees >= 150) {
      monthly = 549;
      setup = 4900;
    } else if (employees >= 50) {
      monthly = 279;
      setup = 2400;
    }

    if (users > 5) {
      monthly += (users - 5) * 9;
    }
    if (warehouses > 1) {
      monthly += (warehouses - 1) * 90;
      setup += (warehouses - 1) * 600;
    }
    if (pricingNeedsCustomSupport) {
      monthly += 140;
      setup += 1200;
    }

    const annual = monthly * 12;
    const annualDiscounted = Math.round(annual * 0.8);
    const annualMonthlyEquivalent = Math.round(annualDiscounted / 12);

    return {
      employees,
      users,
      warehouses,
      monthly,
      setup,
      annual,
      annualDiscounted,
      annualMonthlyEquivalent,
      summary:
        employees >= 150
          ? "Mid-market nasadenie"
          : employees >= 50
            ? "Rastúca firma"
            : "Menšie nasadenie"
    };
  }, [
    pricingEmployeeCount,
    pricingUserCount,
    pricingWarehouseCount,
    pricingNeedsCustomSupport
  ]);

  const resolveUserRole = async (user) => {
    if (!user) {
      return "user";
    }

    const normalizedEmail = String(user.email || "").toLowerCase();
    if (MASTER_EMAIL && normalizedEmail === MASTER_EMAIL) {
      return "master";
    }

    const { data: roleRow, error: roleError } = await supabase
      .from(ROLE_TABLE)
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError) {
      return "user";
    }

    return String(roleRow?.role || "user").toLowerCase() === "master" ? "master" : "user";
  };

  const fetchOwnCompanyIdViaRpc = async (userId) => {
    if (!userId) {
      return null;
    }
    try {
      const { data, error } = await supabase.rpc("user_company_id", { uid: userId });
      if (error) {
        return null;
      }
      return data || null;
    } catch {
      return null;
    }
  };

  const fetchDbMasterFlagViaRpc = async (userId) => {
    if (!userId) {
      return false;
    }
    try {
      const { data, error } = await supabase.rpc("is_master", { uid: userId });
      if (error) {
        return false;
      }
      return Boolean(data);
    } catch {
      return false;
    }
  };

  const fetchOwnRoleRow = async (userId, retries = 2) => {
    if (!userId) {
      return null;
    }

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const { data } = await supabase
        .from(ROLE_TABLE)
        .select("username,email,company_id,can_manage_orders")
        .eq("user_id", userId)
        .maybeSingle();

      if (data) {
        return data;
      }
      if (attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
      }
    }

    return null;
  };

  const userCreatorClient = useMemo(
    () =>
      createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          fetch: noStoreFetch
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: "wms-user-creator"
        }
      }),
    []
  );

  const loadManagedUsers = async () => {
    if (!isMaster) {
      setManagedUsers([]);
      return;
    }

    setManagedUsersLoading(true);
    setManagedUsersError("");
    const { data, error: usersError } = await supabase
      .from(ROLE_TABLE)
      .select("user_id,username,email,role,can_manage_orders,company_id,db_url,db_anon_key,created_at,updated_at,created_by")
      .order("created_at", { ascending: false });

    if (usersError) {
      setManagedUsersError(usersError.message || "Nepodarilo sa načítať používateľov.");
      setManagedUsers([]);
      setManagedUsersLoading(false);
      return;
    }

    const users = data || [];
    const usersMissingCreds = users.filter((row) => !row.db_url || !row.db_anon_key);
    if (usersMissingCreds.length > 0 && DEFAULT_DB_URL && DEFAULT_DB_ANON_KEY) {
      await Promise.all(
        usersMissingCreds.map((row) =>
          supabase
            .from(ROLE_TABLE)
            .update({ db_url: DEFAULT_DB_URL, db_anon_key: DEFAULT_DB_ANON_KEY })
            .eq("user_id", row.user_id)
        )
      );
    }

    setManagedUsers(
      users.map((row) => ({
        ...row,
        can_manage_orders: Boolean(row.can_manage_orders),
        db_url: row.db_url || DEFAULT_DB_URL || null,
        db_anon_key: row.db_anon_key || DEFAULT_DB_ANON_KEY || null
      }))
    );
    setManagedUsersLoading(false);
  };

  const loadCompanies = async () => {
    setCompaniesError("");
    const { data, error: companiesError } = await supabase
      .from("companies")
      .select("id,name,created_at,max_positions,tracks_expiry_date")
      .order("name", { ascending: true });

    if (companiesError) {
      setCompaniesError(companiesError.message || "Nepodarilo sa načítať firmy.");
      setCompanies([]);
      return;
    }

    setCompanies(data || []);
  };

  const recoverBrokenLocalAuthState = async () => {
    clearSupabaseAuthStorage();
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Ignore local cleanup failure; storage key removal is the main recovery path.
    }
  };

  const loadMaterialSubscriptions = async () => {
    if (!authReady || !isLoggedIn || selectedTable !== "stock" || isMaster) {
      setMaterialSubscriptions([]);
      setMaterialSubscriptionsError("");
      return;
    }

    setMaterialSubscriptionsError("");
    let query = supabase
      .from("material_subscriptions")
      .select("id,company_id,material_code,email,is_active,created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (activeCompanyId) {
      query = query.eq("company_id", activeCompanyId);
    } else if (userCompanyId) {
      query = query.eq("company_id", userCompanyId);
    }

    const { data, error: subscriptionsError } = await query;
    if (subscriptionsError) {
      setMaterialSubscriptions([]);
      setMaterialSubscriptionsError(subscriptionsError.message || "Nepodarilo sa načítať odbery materiálov.");
      return;
    }

    setMaterialSubscriptions(data || []);
  };

  const handleMaterialSubscriptionSave = async (event) => {
    event.preventDefault();

    const companyId = activeCompanyId || userCompanyId;
    const materialCode = String(subscriptionMaterialInput || "").trim();
    const email = String(subscriptionEmailInput || "").trim().toLowerCase();
    const key = makeMaterialSubscriptionKey(companyId, materialCode);

    if (!companyId) {
      setMaterialSubscriptionsError("Chýba firma pre uloženie odberu.");
      return;
    }

    if (!materialCode) {
      setMaterialSubscriptionsError("Zadaj materiál, ktorý chceš sledovať.");
      return;
    }

    if (!email || !email.includes("@")) {
      setMaterialSubscriptionsError("Zadaj platný email pre odber upozornení.");
      return;
    }

    setMaterialSubscriptionSavingKey(key);
    setMaterialSubscriptionsError("");

    const existingSubscription =
      materialSubscriptionsByKey[key]?.find((item) => String(item.email || "").toLowerCase() === email) || null;

    if (existingSubscription) {
      const { data, error: updateError } = await supabase
        .from("material_subscriptions")
        .update({ is_active: true })
        .eq("id", existingSubscription.id)
        .select("id,company_id,material_code,email,is_active,created_at")
        .single();

      if (updateError) {
        setMaterialSubscriptionsError(updateError.message || "Nepodarilo sa obnoviť odber.");
        setMaterialSubscriptionSavingKey("");
        return;
      }

      setMaterialSubscriptions((prev) => {
        const withoutCurrent = prev.filter((item) => item.id !== existingSubscription.id);
        return [...withoutCurrent, data].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
      });
      setSubscriptionMaterialInput("");
      setSubscriptionEmailInput("");
      setMaterialSubscriptionSavingKey("");
      return;
    }

    const { data, error: insertError } = await supabase
      .from("material_subscriptions")
      .insert([
        {
          company_id: companyId,
          material_code: materialCode,
          email,
          is_active: true,
          created_by: authUser?.id || null
        }
      ])
      .select("id,company_id,material_code,email,is_active,created_at")
      .single();

    if (insertError) {
      setMaterialSubscriptionsError(insertError.message || "Nepodarilo sa uložiť odber materiálu.");
      setMaterialSubscriptionSavingKey("");
      return;
    }

    setMaterialSubscriptions((prev) =>
      [...prev, data].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    );
    setSubscriptionMaterialInput("");
    setSubscriptionEmailInput("");
    setMaterialSubscriptionSavingKey("");
  };

  const handleMaterialSubscriptionDisable = async (subscription) => {
    const key = makeMaterialSubscriptionKey(subscription.company_id, subscription.material_code);
    const existingSubscription = subscription || null;

    if (!existingSubscription) {
      return;
    }

    setMaterialSubscriptionSavingKey(key);
    setMaterialSubscriptionsError("");

    const { error: updateError } = await supabase
      .from("material_subscriptions")
      .update({ is_active: false })
      .eq("id", existingSubscription.id);

    if (updateError) {
      setMaterialSubscriptionsError(updateError.message || "Nepodarilo sa vypnúť odber.");
      setMaterialSubscriptionSavingKey("");
      return;
    }

    setMaterialSubscriptions((prev) => prev.filter((item) => item.id !== existingSubscription.id));
    setMaterialSubscriptionSavingKey("");
  };

  const resetPriceListForm = () => {
    setPriceListMaterialInput("");
    setPriceListUnitInput("ks");
    setPriceListValueInput("");
    setPriceListPurchaseInput("");
    setPriceListNoteInput("");
    setPriceListImportResult("");
    setPriceListFormError("");
  };

  const fillPriceListFormFromRow = (row) => {
    if (!row) {
      resetPriceListForm();
      return;
    }

    setPriceListMaterialInput(String(row.material_code || ""));
    setPriceListUnitInput(String(row.unit || "ks"));
    setPriceListValueInput(row.unit_price === null || row.unit_price === undefined ? "" : String(row.unit_price));
    setPriceListPurchaseInput(row.purchase_price === null || row.purchase_price === undefined ? "" : String(row.purchase_price));
    setPriceListNoteInput(String(row.note || ""));
    setPriceListFormError("");
  };

  const handlePriceListMaterialChange = (value) => {
    setPriceListMaterialInput(value);
    const matchedRow = priceListRowsByMaterial[normalizeOptionSearchValue(value)] || null;
    if (matchedRow) {
      setPriceListUnitInput(String(matchedRow.unit || "ks"));
      setPriceListValueInput(matchedRow.unit_price === null || matchedRow.unit_price === undefined ? "" : String(matchedRow.unit_price));
      setPriceListPurchaseInput(
        matchedRow.purchase_price === null || matchedRow.purchase_price === undefined ? "" : String(matchedRow.purchase_price)
      );
      setPriceListNoteInput(String(matchedRow.note || ""));
      setPriceListFormError("");
      return;
    }

    setPriceListUnitInput("ks");
    setPriceListValueInput("");
    setPriceListPurchaseInput("");
    setPriceListNoteInput("");
    setPriceListFormError("");
  };

  const handleSavePriceListItem = async (event) => {
    event.preventDefault();

    const companyId = activeCompanyId || userCompanyId || null;
    const materialCode = String(priceListMaterialInput || "").trim();
    const unit = String(priceListUnitInput || "").trim() || "ks";
    const unitPrice = normalizePriceInput(priceListValueInput);
    const purchasePrice = normalizePriceInput(priceListPurchaseInput);
    const note = String(priceListNoteInput || "").trim();

    if (!companyId) {
      setPriceListFormError("Vyber konkrétnu firmu, aby sa dal uložiť cenník.");
      return;
    }

    if (!materialCode) {
      setPriceListFormError("Zadaj materiál pre cenník.");
      return;
    }

    if (unitPrice === null) {
      setPriceListFormError("Zadaj platnú cenu, napr. 12,50.");
      return;
    }

    if (purchasePrice === null) {
      setPriceListFormError("Zadaj platnú nákupnú cenu, napr. 9,40.");
      return;
    }

    setPriceListSubmitting(true);
    setPriceListFormError("");

    const { error: upsertError } = await supabase.from(PRICE_LIST_TABLE).upsert(
      [
        {
          company_id: companyId,
          material_code: materialCode,
          unit,
          unit_price: unitPrice,
          purchase_price: purchasePrice,
          note,
          created_by: selectedPriceListRow?.created_by || authUser?.id || null
        }
      ],
      { onConflict: "company_id,material_code" }
    );

    if (upsertError) {
      setPriceListFormError(upsertError.message || "Nepodarilo sa uložiť položku cenníka.");
      setPriceListSubmitting(false);
      return;
    }

    await loadRows(PRICE_LIST_TABLE);
    setPriceListSubmitting(false);
  };

  const handleDeletePriceListItem = async () => {
    const existingRow = selectedPriceListRow;
    if (!existingRow?.id) {
      setPriceListFormError("Najprv vyber existujúcu položku cenníka na zmazanie.");
      return;
    }

    setPriceListDeleting(true);
    setPriceListFormError("");

    const { error: deleteError } = await supabase.from(PRICE_LIST_TABLE).delete().eq("id", existingRow.id);
    if (deleteError) {
      setPriceListFormError(deleteError.message || "Nepodarilo sa zmazať položku cenníka.");
      setPriceListDeleting(false);
      return;
    }

    resetPriceListForm();
    await loadRows(PRICE_LIST_TABLE);
    setPriceListDeleting(false);
  };

  const handlePriceListImport = async (event) => {
    const file = event.target.files?.[0] || null;
    const clearInput = () => {
      if (priceListImportInputRef.current) {
        priceListImportInputRef.current.value = "";
      }
    };

    if (!file) {
      return;
    }

    const companyId = activeCompanyId || userCompanyId || null;
    if (!companyId) {
      setPriceListFormError("Vyber konkrétnu firmu, aby sa dal importovať cenník.");
      clearInput();
      return;
    }

    setPriceListImportSubmitting(true);
    setPriceListImportResult("");
    setPriceListFormError("");

    try {
      const rawRows = await readSpreadsheetRows(file);
      const headers = Object.keys(rawRows[0] || {});
      const materialColumn = resolvePriceListImportColumn(headers, [
        "material_code",
        "material",
        "material_kod",
        "materialkod",
        "sku",
        "kod",
        "kod_materialu"
      ]);
      const unitColumn = resolvePriceListImportColumn(headers, ["unit", "jednotka", "mj", "m_j"]);
      const salePriceColumn = resolvePriceListImportColumn(headers, [
        "unit_price",
        "predajna_cena",
        "predajna",
        "cena_bez_dph",
        "predajna_cenabez_dph",
        "sale_price",
        "price"
      ]);
      const purchasePriceColumn = resolvePriceListImportColumn(headers, [
        "purchase_price",
        "nakupna_cena",
        "nakupna",
        "cost_price",
        "cost"
      ]);
      const noteColumn = resolvePriceListImportColumn(headers, ["note", "poznamka", "comment", "komentar"]);

      if (!materialColumn || !salePriceColumn || !purchasePriceColumn) {
        throw new Error(
          "Import potrebuje stĺpce materiál, predajná cena a nákupná cena. Povolené názvy sú napr. material_code, cena bez dph, nakupna cena."
        );
      }

      const invalidRows = [];
      const dedupedRows = new Map();

      rawRows.forEach((row, index) => {
        const rowNumber = index + 2;
        const materialCode = String(row?.[materialColumn] || "").trim();
        const unit = String(row?.[unitColumn] || "").trim() || "ks";
        const salePrice = normalizePriceInput(row?.[salePriceColumn]);
        const purchasePrice = normalizePriceInput(row?.[purchasePriceColumn]);
        const note = String(row?.[noteColumn] || "").trim();

        if (!materialCode) {
          invalidRows.push(`Riadok ${rowNumber}: chýba materiál.`);
          return;
        }

        if (salePrice === null) {
          invalidRows.push(`Riadok ${rowNumber}: neplatná predajná cena pri ${materialCode}.`);
          return;
        }

        if (purchasePrice === null) {
          invalidRows.push(`Riadok ${rowNumber}: neplatná nákupná cena pri ${materialCode}.`);
          return;
        }

        dedupedRows.set(normalizeOptionSearchValue(materialCode), {
          company_id: companyId,
          material_code: materialCode,
          unit,
          unit_price: salePrice,
          purchase_price: purchasePrice,
          note,
          created_by: authUser?.id || null
        });
      });

      const rowsToImport = Array.from(dedupedRows.values());
      if (rowsToImport.length === 0) {
        throw new Error(invalidRows[0] || "V súbore nie sú žiadne použiteľné riadky.");
      }

      const chunkSize = 250;
      for (let index = 0; index < rowsToImport.length; index += chunkSize) {
        const chunk = rowsToImport.slice(index, index + chunkSize);
        const { error: importError } = await supabase.from(PRICE_LIST_TABLE).upsert(chunk, {
          onConflict: "company_id,material_code"
        });
        if (importError) {
          throw importError;
        }
      }

      await loadRows(PRICE_LIST_TABLE);
      setPriceListImportResult(
        invalidRows.length > 0
          ? `Naimportovaných ${rowsToImport.length} položiek. Preskočené riadky: ${invalidRows.slice(0, 3).join(" | ")}`
          : `Naimportovaných ${rowsToImport.length} položiek z ${file.name}.`
      );
    } catch (importError) {
      setPriceListFormError(importError?.message || "Nepodarilo sa importovať cenník.");
    } finally {
      setPriceListImportSubmitting(false);
      clearInput();
    }
  };

  const handleCreateCompany = async (event) => {
    event.preventDefault();
    setCreateCompanySubmitting(true);
    setManagedUsersError("");

    const name = String(newCompanyName || "").trim();
    if (!name) {
      setManagedUsersError("Zadaj názov firmy.");
      setCreateCompanySubmitting(false);
      return;
    }

    const { data: inserted, error: createError } = await supabase
      .from("companies")
      .insert([{ name, tracks_expiry_date: newCompanyTracksExpiryDate }])
      .select("id,name,created_at,max_positions,tracks_expiry_date")
      .single();

    if (createError) {
      setCompaniesError(createError.message || "Nepodarilo sa vytvoriť firmu.");
      setCreateCompanySubmitting(false);
      return;
    }

    setNewCompanyName("");
    setNewCompanyTracksExpiryDate(false);
    if (inserted) {
      setCompanies((prev) =>
        [...prev.filter((company) => company.id !== inserted.id), inserted].sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), "sk-SK", { sensitivity: "base" })
        )
      );
    }
    setCreateCompanySubmitting(false);
  };

  const handleStartEditCompany = (company) => {
    setEditingCompanyId(company?.id || "");
    setEditingCompanyName(String(company?.name || ""));
    setEditingCompanyTracksExpiryDate(Boolean(company?.tracks_expiry_date));
    setCompaniesError("");
  };

  const handleCancelEditCompany = () => {
    setEditingCompanyId("");
    setEditingCompanyName("");
    setEditingCompanyTracksExpiryDate(false);
  };

  const handleSaveCompany = async (companyId) => {
    const name = String(editingCompanyName || "").trim();
    if (!name) {
      setCompaniesError("Názov firmy nemôže byť prázdny.");
      return;
    }
    setUpdateCompanySubmitting(true);
    setCompaniesError("");
    const { data, error: updateError } = await supabase
      .from("companies")
      .update({ name, tracks_expiry_date: editingCompanyTracksExpiryDate })
      .eq("id", companyId)
      .select("id,name,created_at,max_positions,tracks_expiry_date")
      .single();

    if (updateError) {
      setCompaniesError(updateError.message || "Nepodarilo sa upraviť firmu.");
      setUpdateCompanySubmitting(false);
      return;
    }

    setCompanies((prev) =>
      prev
        .map((company) => (company.id === companyId ? data : company))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "sk-SK", { sensitivity: "base" }))
    );
    setUpdateCompanySubmitting(false);
    handleCancelEditCompany();
  };

  const handleDeleteCompany = async (company) => {
    if (!company?.id) {
      return;
    }
    const confirmed = window.confirm(`Naozaj chceš zmazať firmu "${company.name}"?`);
    if (!confirmed) {
      return;
    }

    setDeleteCompanySubmitting(true);
    setCompaniesError("");
    const { error: deleteError } = await supabase.from("companies").delete().eq("id", company.id);
    if (deleteError) {
      setCompaniesError(deleteError.message || "Nepodarilo sa zmazať firmu.");
      setDeleteCompanySubmitting(false);
      return;
    }

    setCompanies((prev) => prev.filter((item) => item.id !== company.id));
    if (selectedCompanyId === company.id) {
      setSelectedCompanyId("all");
    }
    if (newUserCompanyId === company.id) {
      setNewUserCompanyId("");
    }
    setDeleteCompanySubmitting(false);
  };

  const ensureOwnRoleRow = async (user, resolvedRole) => {
    if (!user) {
      return;
    }

    const rowRole = resolvedRole === "master" ? "master" : "user";
    const username = usernameFromInternalEmail(user.email);
    await supabase.from(ROLE_TABLE).upsert(
      {
        user_id: user.id,
        email: String(user.email || "").toLowerCase(),
        username,
        role: rowRole,
        can_manage_orders: rowRole === "master",
        db_url: DEFAULT_DB_URL || null,
        db_anon_key: DEFAULT_DB_ANON_KEY || null,
        created_by: user.id
      },
      { onConflict: "user_id" }
    );
  };

  const handleCreateManagedUser = async (event) => {
    event.preventDefault();
    setCreateUserSubmitting(true);
    setManagedUsersError("");

    const username = normalizeUsernameInput(newUsername);
    if (!username) {
      setManagedUsersError("Zadaj login (username).");
      setCreateUserSubmitting(false);
      return;
    }
    const email = buildInternalEmailFromUsername(username);

    if (newUserPassword.length < MIN_MANAGED_PASSWORD_LENGTH) {
      setManagedUsersError(`Heslo musí mať aspoň ${MIN_MANAGED_PASSWORD_LENGTH} znakov.`);
      setCreateUserSubmitting(false);
      return;
    }

    const effectiveCompanyIdForUser =
      newUserRole === "master" ? null : newUserCompanyId || (selectedCompanyId !== "all" ? selectedCompanyId : "");

    if (newUserRole !== "master" && !effectiveCompanyIdForUser) {
      setManagedUsersError("Pre user účet vyber firmu.");
      setCreateUserSubmitting(false);
      return;
    }

    const { data: signUpData, error: signUpError } = await userCreatorClient.auth.signUp({
      email,
      password: newUserPassword
    });

    if (signUpError) {
      setManagedUsersError(signUpError.message || "Nepodarilo sa vytvoriť používateľa.");
      setCreateUserSubmitting(false);
      return;
    }

    const createdUserId = signUpData?.user?.id;
    if (!createdUserId) {
      setManagedUsersError("Používateľ bol vytvorený, ale nepodarilo sa získať jeho ID.");
      setCreateUserSubmitting(false);
      return;
    }

    const { error: roleWriteError } = await supabase.from(ROLE_TABLE).upsert(
      {
        user_id: createdUserId,
        email,
        username,
        role: newUserRole === "master" ? "master" : "user",
        can_manage_orders: newUserRole === "master" ? true : newUserCanManageOrders,
        company_id: newUserRole === "master" ? null : effectiveCompanyIdForUser,
        db_url: DEFAULT_DB_URL || null,
        db_anon_key: DEFAULT_DB_ANON_KEY || null,
        created_by: authUser?.id || null
      },
      { onConflict: "user_id" }
    );

    if (roleWriteError) {
      setManagedUsersError(roleWriteError.message || "Používateľ je vytvorený, ale nepodarilo sa uložiť rolu.");
      setCreateUserSubmitting(false);
      return;
    }

    if (newUserRole !== "master") {
      const { data: verifyRow } = await supabase
        .from(ROLE_TABLE)
        .select("company_id")
        .eq("user_id", createdUserId)
        .maybeSingle();
      if (!verifyRow?.company_id) {
        setManagedUsersError("User bol vytvorený, ale neuložila sa firma. Skús uložiť firmu znova.");
      }
    }

    setNewUsername("");
    setNewUserPassword("");
    setNewUserRole("user");
    setNewUserCompanyId("");
    setNewUserCanManageOrders(false);
    setCreateUserSubmitting(false);
    await loadManagedUsers();
  };

  const handleManagedRoleChange = async (row, nextRole) => {
    if (!row?.user_id) {
      return;
    }

    if (row.user_id === authUser?.id && nextRole !== "master") {
      setManagedUsersError("Master účet nemožno znížiť cez vlastnú reláciu.");
      return;
    }
    if (nextRole === "user" && !row.company_id) {
      setManagedUsersError("Pred prepnutím na user rolu najprv nastav firmu.");
      return;
    }

    setManagedUsersError("");
    const { error: updateError } = await supabase
      .from(ROLE_TABLE)
      .update({
        role: nextRole,
        can_manage_orders: nextRole === "master" ? true : Boolean(row.can_manage_orders)
      })
      .eq("user_id", row.user_id);

    if (updateError) {
      setManagedUsersError(updateError.message || "Nepodarilo sa zmeniť rolu.");
      return;
    }

    await loadManagedUsers();
  };

  const handleManagedOrderAccessChange = async (row, nextValue) => {
    if (!row?.user_id || row.role === "master") {
      return;
    }

    setManagedUsersError("");
    const { error: updateError } = await supabase
      .from(ROLE_TABLE)
      .update({ can_manage_orders: Boolean(nextValue) })
      .eq("user_id", row.user_id);

    if (updateError) {
      setManagedUsersError(updateError.message || "Nepodarilo sa uložiť prístup k objednávkam.");
      return;
    }

    await loadManagedUsers();
  };

  const handleManagedCompanyChange = async (row, nextCompanyId) => {
    if (!row?.user_id) {
      return;
    }

    const normalizedCompany = nextCompanyId || null;
    if (row.role !== "master" && !normalizedCompany) {
      setManagedUsersError("User účet musí mať priradenú firmu.");
      return;
    }
    const { error: updateError } = await supabase
      .from(ROLE_TABLE)
      .update({ company_id: normalizedCompany })
      .eq("user_id", row.user_id);

    if (updateError) {
      setManagedUsersError(updateError.message || "Nepodarilo sa zmeniť firmu.");
      return;
    }

    await loadManagedUsers();
  };

  const handleDeleteManagedUser = async (row) => {
    if (!row?.user_id) {
      return;
    }
    if (row.user_id === authUser?.id) {
      setManagedUsersError("Aktuálne prihlásený master účet nie je možné zmazať.");
      return;
    }

    const login = row.username || usernameFromInternalEmail(row.email) || row.user_id;
    const confirmed = window.confirm(
      `Zmazať účet "${login}"? Zmaže sa profil v app_users (odoberie sa prístup do webu).`
    );
    if (!confirmed) {
      return;
    }

    setDeleteUserSubmitting(true);
    setManagedUsersError("");
    const { error: deleteError } = await supabase.from(ROLE_TABLE).delete().eq("user_id", row.user_id);
    if (deleteError) {
      setManagedUsersError(deleteError.message || "Nepodarilo sa zmazať účet.");
      setDeleteUserSubmitting(false);
      return;
    }

    setDeleteUserSubmitting(false);
    await loadManagedUsers();
  };

  const handleRepairUsersWithoutCompany = async () => {
    if (!isMaster) {
      return;
    }
    if (!selectedCompanyId || selectedCompanyId === "all") {
      setManagedUsersError("Najprv vyber konkrétnu firmu v hornom filtri.");
      return;
    }

    const missingUsers = managedUsers.filter((row) => row.role !== "master" && !row.company_id);
    if (missingUsers.length === 0) {
      setManagedUsersError("Všetci useri už majú priradenú firmu.");
      return;
    }

    setRepairUsersSubmitting(true);
    setManagedUsersError("");
    const updates = await Promise.all(
      missingUsers.map((row) =>
        supabase.from(ROLE_TABLE).update({ company_id: selectedCompanyId }).eq("user_id", row.user_id)
      )
    );

    const failed = updates.find((result) => result.error);
    if (failed?.error) {
      setManagedUsersError(failed.error.message || "Nepodarilo sa opraviť firmy pre všetkých userov.");
      setRepairUsersSubmitting(false);
      return;
    }

    setRepairUsersSubmitting(false);
    await loadManagedUsers();
  };

  const handleCompanyScopeChange = (nextCompanyId) => {
    if (!isMaster) {
      return;
    }
    setSelectedCompanyId(nextCompanyId || "all");
  };

  const handleSaveCompanyMaxPositions = async (event) => {
    event.preventDefault();
    if (!activeCompanyId) {
      setCompanySettingsError("Najprv vyber konkrétnu firmu.");
      return;
    }

    setCompanySettingsSubmitting(true);
    setCompanySettingsError("");

    const normalizedValue = normalizeMaxPositions(companyMaxPositionsInput);
    const { data, error: saveError } = await supabase.rpc("set_company_max_positions", {
      target_company_id: activeCompanyId,
      target_max_positions: normalizedValue
    });

    if (saveError) {
      setCompanySettingsError(saveError.message || "Nepodarilo sa uložiť počet miest na sklade.");
      setCompanySettingsSubmitting(false);
      return;
    }

    const updatedCompany = Array.isArray(data) ? data[0] : data;
    if (!updatedCompany?.id) {
      setCompanySettingsSubmitting(false);
      return;
    }

    const { data: expiryUpdatedCompany, error: expiryUpdateError } = await supabase
      .from("companies")
      .update({ tracks_expiry_date: companyTracksExpiryDateInput })
      .eq("id", updatedCompany.id)
      .select("id,name,created_at,max_positions,tracks_expiry_date")
      .single();

    if (expiryUpdateError) {
      setCompanySettingsError(expiryUpdateError.message || "Nepodarilo sa uložiť sledovanie expirácie.");
      setCompanySettingsSubmitting(false);
      return;
    }

    setCompanies((prev) =>
      prev.map((company) =>
        company.id === expiryUpdatedCompany.id
          ? {
              ...company,
              max_positions: normalizeMaxPositions(expiryUpdatedCompany.max_positions),
              tracks_expiry_date: Boolean(expiryUpdatedCompany.tracks_expiry_date)
            }
          : company
      )
    );
    setCompanyMaxPositionsInput(String(normalizeMaxPositions(expiryUpdatedCompany.max_positions)));
    setCompanyTracksExpiryDateInput(Boolean(expiryUpdatedCompany.tracks_expiry_date));

    setCompanySettingsSubmitting(false);
  };

  const resetOrderDraft = () => {
    setOrderDraftItems([createEmptyOrderDraftItem()]);
  };

  const loadOrdersModuleData = async () => {
    if (!authReady || !isLoggedIn || !canAccessOrdersModule) {
      setCustomers([]);
      setOrders([]);
      setOrderItems([]);
      setOrdersStockRows([]);
      setOrdersLoading(false);
      setOrdersError("");
      return;
    }

    setOrdersLoading(true);
    setOrdersError("");

    try {
      let effectiveUserCompanyId = userCompanyId;
      if (!isMaster && !effectiveUserCompanyId && authUser?.id) {
        const resolvedCompanyId = await fetchOwnCompanyIdViaRpc(authUser.id);
        if (resolvedCompanyId) {
          effectiveUserCompanyId = resolvedCompanyId;
          setUserCompanyId(resolvedCompanyId);
          setSelectedCompanyId(resolvedCompanyId);
        }
      }

      const companyScope = isMaster ? selectedCompanyId : effectiveUserCompanyId;
      const scopedCompanyId = companyScope && companyScope !== "all" ? companyScope : null;
      const customersQuery = supabase
        .from("customers")
        .select("id,company_id,name,email,phone,address,note,created_at,created_by")
        .order("name", { ascending: true });
      const ordersQuery = supabase
        .from("orders")
        .select("id,company_id,customer_id,customer_name,order_number,note,created_at,created_by")
        .order("created_at", { ascending: false });
      const stockQuery = supabase
        .from("stock")
        .select("company_id,position,material_code,quantity")
        .order("material_code", { ascending: true });

      const scopedCustomersQuery = scopedCompanyId ? customersQuery.eq("company_id", scopedCompanyId) : customersQuery;
      const scopedOrdersQuery = scopedCompanyId ? ordersQuery.eq("company_id", scopedCompanyId) : ordersQuery;
      const scopedStockQuery = scopedCompanyId ? stockQuery.eq("company_id", scopedCompanyId) : stockQuery;

      const [{ data: customersData, error: customersError }, { data: ordersData, error: ordersLoadError }, { data: stockData, error: stockError }] =
        await Promise.all([scopedCustomersQuery, scopedOrdersQuery, scopedStockQuery]);

      if (customersError) {
        throw customersError;
      }
      if (ordersLoadError) {
        throw ordersLoadError;
      }
      if (stockError) {
        throw stockError;
      }

      const orderIds = (ordersData || []).map((row) => row.id).filter(Boolean);
      let itemsData = [];
      if (orderIds.length > 0) {
        const { data, error: itemsError } = await supabase
          .from("order_items")
          .select("id,order_id,material_code,position,ordered_quantity,stock_quantity_snapshot,line_note,created_at")
          .in("order_id", orderIds)
          .order("created_at", { ascending: true });

        if (itemsError) {
          throw itemsError;
        }
        itemsData = data || [];
      }

      setCustomers(customersData || []);
      setOrders(ordersData || []);
      setOrderItems(itemsData);
      setOrdersStockRows(stockData || []);
      if (!selectedOrderCustomerId && (customersData || []).length === 1) {
        setSelectedOrderCustomerId(customersData[0].id);
      }
    } catch (loadOrdersError) {
      setOrdersError(loadOrdersError?.message || "Nepodarilo sa načítať objednávky.");
      setCustomers([]);
      setOrders([]);
      setOrderItems([]);
      setOrdersStockRows([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  const resetProductionDraft = () => {
    setProductionTitleInput("");
    setProductionDraftInputs([createEmptyProductionInputDraft()]);
    setProductionDraftOutputs([createEmptyProductionOutputDraft()]);
  };

  const loadProductionModuleData = async () => {
    if (!authReady || !isLoggedIn || !canAccessOrdersModule) {
      setProductionOrders([]);
      setProductionOrderInputs([]);
      setProductionOrderOutputs([]);
      setProductionStockRows([]);
      setProductionLoading(false);
      setProductionError("");
      return;
    }

    const requestId = latestLoadRowsRequestRef.current + 1;
    latestLoadRowsRequestRef.current = requestId;
    setProductionLoading(true);
    setProductionError("");

    try {
      const scopedCompanyId = activeCompanyId || userCompanyId || null;
      const productionOrdersQuery = supabase
        .from("production_orders")
        .select("id,company_id,production_number,title,status,note,created_at,created_by,completed_at,completed_by")
        .order("created_at", { ascending: false });
      const stockQuery = supabase
        .from("stock")
        .select("company_id,position,material_code,quantity")
        .order("material_code", { ascending: true });

      const scopedProductionOrdersQuery = scopedCompanyId ? productionOrdersQuery.eq("company_id", scopedCompanyId) : productionOrdersQuery;
      const scopedStockQuery = scopedCompanyId ? stockQuery.eq("company_id", scopedCompanyId) : stockQuery;

      const [{ data: productionOrdersData, error: productionOrdersError }, { data: stockData, error: stockError }] =
        await Promise.all([scopedProductionOrdersQuery, scopedStockQuery]);

      if (productionOrdersError) {
        throw productionOrdersError;
      }
      if (stockError) {
        throw stockError;
      }

      const productionOrderIds = (productionOrdersData || []).map((row) => row.id).filter(Boolean);
      let inputsData = [];
      let outputsData = [];
      if (productionOrderIds.length > 0) {
        const [{ data: fetchedInputs, error: inputsError }, { data: fetchedOutputs, error: outputsError }] = await Promise.all([
          supabase
            .from("production_order_inputs")
            .select("id,production_order_id,material_code,position,required_quantity,stock_quantity_snapshot,line_note,created_at")
            .in("production_order_id", productionOrderIds)
            .order("created_at", { ascending: true }),
          supabase
            .from("production_order_outputs")
            .select("id,production_order_id,material_code,position,output_quantity,line_note,created_at")
            .in("production_order_id", productionOrderIds)
            .order("created_at", { ascending: true })
        ]);

        if (inputsError) {
          throw inputsError;
        }
        if (outputsError) {
          throw outputsError;
        }
        inputsData = fetchedInputs || [];
        outputsData = fetchedOutputs || [];
      }

      if (latestLoadRowsRequestRef.current !== requestId) {
        return;
      }

      setProductionOrders(productionOrdersData || []);
      setProductionOrderInputs(inputsData);
      setProductionOrderOutputs(outputsData);
      setProductionStockRows(stockData || []);
    } catch (loadProductionError) {
      setProductionError(loadProductionError?.message || "Nepodarilo sa načítať výrobné objednávky.");
      setProductionOrders([]);
      setProductionOrderInputs([]);
      setProductionOrderOutputs([]);
      setProductionStockRows([]);
    } finally {
      setProductionLoading(false);
    }
  };

  const handleProductionInputChange = (index, field, value) => {
    setProductionDraftInputs((prev) =>
      prev.map((item, currentIndex) => {
        if (currentIndex !== index) {
          return item;
        }

        if (field === "stockInput") {
          const matchedOption = resolveOrderStockOption(value, productionStockOptions);
          return {
            ...item,
            stockInput: matchedOption ? matchedOption.label : value,
            stockKey: matchedOption ? matchedOption.stockKey : ""
          };
        }

        return { ...item, [field]: value };
      })
    );
  };

  const handleAddProductionInput = () => {
    setProductionDraftInputs((prev) => [...prev, createEmptyProductionInputDraft()]);
  };

  const handleRemoveProductionInput = (index) => {
    setProductionDraftInputs((prev) =>
      prev.length <= 1 ? [createEmptyProductionInputDraft()] : prev.filter((_, itemIndex) => itemIndex !== index)
    );
  };

  const handleProductionOutputChange = (index, field, value) => {
    setProductionDraftOutputs((prev) =>
      prev.map((item, currentIndex) => (currentIndex === index ? { ...item, [field]: value } : item))
    );
  };

  const handleAddProductionOutput = () => {
    setProductionDraftOutputs((prev) => [...prev, createEmptyProductionOutputDraft()]);
  };

  const handleRemoveProductionOutput = (index) => {
    setProductionDraftOutputs((prev) =>
      prev.length <= 1 ? [createEmptyProductionOutputDraft()] : prev.filter((_, itemIndex) => itemIndex !== index)
    );
  };

  const handleCreateProductionOrder = async (event) => {
    event.preventDefault();

    const companyId = activeCompanyId || userCompanyId;
    const title = String(productionTitleInput || "").trim();
    if (!companyId) {
      setProductionError("Vyber firmu pre výrobnú objednávku.");
      return;
    }
    if (!title) {
      setProductionError("Zadaj názov výrobnej objednávky.");
      return;
    }

    const normalizedInputs = [];
    for (let index = 0; index < productionDraftInputs.length; index += 1) {
      const item = productionDraftInputs[index];
      const resolvedOption = productionStockMap[item.stockKey]
        ? { stockKey: item.stockKey, row: productionStockMap[item.stockKey] }
        : resolveOrderStockOption(item.stockInput, productionStockOptions);
      const stockRow = resolvedOption?.row || null;
      const inputLabel = String(item.stockInput || stockRow?.material_code || "").trim();
      if (!inputLabel) {
        continue;
      }
      const requiredQuantity = Number.parseInt(String(item.requiredQuantity || "0"), 10);
      if (!Number.isFinite(requiredQuantity) || requiredQuantity < 1) {
        setProductionError(`Zadaj platné množstvo vstupu pre ${String(inputLabel || stockRow?.material_code || "-")}.`);
        return;
      }

      normalizedInputs.push({
        material_code: String(stockRow?.material_code || inputLabel),
        position: String(stockRow?.position || ""),
        required_quantity: requiredQuantity,
        stock_quantity_snapshot: Number(stockRow?.quantity || 0),
        line_note: String(item.lineNote || "").trim()
      });
    }

    const normalizedOutputs = [];
    for (const item of productionDraftOutputs) {
      const materialCode = String(item.materialCode || "").trim();
      const position = PRODUCTION_OUTPUT_DEFAULT_POSITION;
      if (!materialCode) {
        continue;
      }
      const outputQuantity = Number.parseInt(String(item.outputQuantity || "0"), 10);
      if (!Number.isFinite(outputQuantity) || outputQuantity < 1) {
        setProductionError(`Zadaj platné množstvo výstupu pre ${materialCode}.`);
        return;
      }

      normalizedOutputs.push({
        material_code: materialCode,
        position,
        output_quantity: outputQuantity,
        line_note: String(item.lineNote || "").trim()
      });
    }

    if (normalizedInputs.length === 0) {
      setProductionError("Pridaj aspoň jeden vstup výroby.");
      return;
    }
    if (normalizedOutputs.length === 0) {
      setProductionError("Pridaj aspoň jeden výstup výroby.");
      return;
    }

    setProductionSubmitting(true);
    setProductionError("");

    const { data: productionOrderRow, error: productionInsertError } = await supabase
      .from("production_orders")
      .insert([
        {
          company_id: companyId,
          production_number: buildProductionNumber(),
          title,
          status: "draft",
          note: "",
          created_by: authUser?.id || null
        }
      ])
      .select("id,company_id,production_number,title,status,note,created_at,created_by,completed_at,completed_by")
      .single();

    if (productionInsertError) {
      setProductionError(productionInsertError.message || "Nepodarilo sa vytvoriť výrobnú objednávku.");
      setProductionSubmitting(false);
      return;
    }

    const [{ data: insertedInputs, error: inputsInsertError }, { data: insertedOutputs, error: outputsInsertError }] = await Promise.all([
      supabase
        .from("production_order_inputs")
        .insert(normalizedInputs.map((item) => ({ ...item, production_order_id: productionOrderRow.id })))
        .select("id,production_order_id,material_code,position,required_quantity,stock_quantity_snapshot,line_note,created_at"),
      supabase
        .from("production_order_outputs")
        .insert(normalizedOutputs.map((item) => ({ ...item, production_order_id: productionOrderRow.id })))
        .select("id,production_order_id,material_code,position,output_quantity,line_note,created_at")
    ]);

    if (inputsInsertError || outputsInsertError) {
      setProductionError(inputsInsertError?.message || outputsInsertError?.message || "Výrobná objednávka sa vytvorila, ale položky sa nepodarilo uložiť.");
      setProductionSubmitting(false);
      await loadProductionModuleData();
      return;
    }

    setProductionOrders((prev) => [productionOrderRow, ...prev]);
    setProductionOrderInputs((prev) => [...prev, ...(insertedInputs || [])]);
    setProductionOrderOutputs((prev) => [...prev, ...(insertedOutputs || [])]);
    setExpandedProductionOrders((prev) => ({ ...prev, [productionOrderRow.id]: true }));
    resetProductionDraft();
    setProductionSubmitting(false);
  };

  const handleCompleteProductionOrder = async (productionOrder) => {
    if (!productionOrder?.id || productionOrder.status === "completed") {
      return;
    }

    const inputs = productionInputsByOrderId[productionOrder.id] || [];
    const outputs = productionOutputsByOrderId[productionOrder.id] || [];
    if (inputs.length === 0 || outputs.length === 0) {
      setProductionError("Výrobná objednávka musí mať vstupy aj výstupy.");
      return;
    }

    setProductionCompletingId(productionOrder.id);
    setProductionError("");

    const { data: liveStockRows, error: liveStockError } = await supabase
      .from("stock")
      .select("company_id,position,material_code,quantity")
      .eq("company_id", productionOrder.company_id);

    if (liveStockError) {
      setProductionError(liveStockError.message || "Nepodarilo sa načítať aktuálny stav skladu.");
      setProductionCompletingId("");
      return;
    }

    const liveStockMap = Object.fromEntries(
      (liveStockRows || []).map((row) => [makeStockKey(row.position, row.material_code, row.company_id), row])
    );

    const stockBoundInputs = inputs.filter((input) => String(input.position || "").trim());
    const requiredByStockKey = {};
    const inputsByStockKey = {};
    for (const input of stockBoundInputs) {
      const stockKey = makeStockKey(input.position, input.material_code, productionOrder.company_id);
      requiredByStockKey[stockKey] = (requiredByStockKey[stockKey] || 0) + Number(input.required_quantity || 0);
      if (!inputsByStockKey[stockKey]) {
        inputsByStockKey[stockKey] = {
          position: input.position,
          material_code: input.material_code,
          totalQuantity: 0
        };
      }
      inputsByStockKey[stockKey].totalQuantity += Number(input.required_quantity || 0);
    }
    const outputsByStockKey = {};
    for (const output of outputs) {
      const stockKey = makeStockKey(output.position, output.material_code, productionOrder.company_id);
      if (!outputsByStockKey[stockKey]) {
        outputsByStockKey[stockKey] = {
          position: output.position,
          material_code: output.material_code,
          totalQuantity: 0
        };
      }
      outputsByStockKey[stockKey].totalQuantity += Number(output.output_quantity || 0);
    }

    const invalidStock = Object.entries(requiredByStockKey).find(
      ([stockKey, requiredQuantity]) => Number(liveStockMap[stockKey]?.quantity || 0) < Number(requiredQuantity || 0)
    );
    if (invalidStock) {
      const stockRow = liveStockMap[invalidStock[0]];
      setProductionError(`Na dokončenie výroby chýba materiál ${String(stockRow?.material_code || "-")}.`);
      setProductionCompletingId("");
      return;
    }

    for (const [stockKey, inputGroup] of Object.entries(inputsByStockKey)) {
      const liveRow = liveStockMap[stockKey];
      const nextQuantity = Number(liveRow?.quantity || 0) - Number(inputGroup.totalQuantity || 0);

      if (nextQuantity <= 0) {
        const { error: deleteError } = await supabase
          .from("stock")
          .delete()
          .eq("company_id", productionOrder.company_id)
          .eq("position", inputGroup.position)
          .eq("material_code", inputGroup.material_code);
        if (deleteError) {
          setProductionError(deleteError.message || "Nepodarilo sa odpísať vstupný materiál.");
          setProductionCompletingId("");
          return;
        }
        delete liveStockMap[stockKey];
      } else {
        const { error: updateError } = await supabase
          .from("stock")
          .update({ quantity: nextQuantity })
          .eq("company_id", productionOrder.company_id)
          .eq("position", inputGroup.position)
          .eq("material_code", inputGroup.material_code);
        if (updateError) {
          setProductionError(updateError.message || "Nepodarilo sa odpísať vstupný materiál.");
          setProductionCompletingId("");
          return;
        }
        liveStockMap[stockKey] = { ...liveRow, quantity: nextQuantity };
      }
    }

    for (const [stockKey, outputGroup] of Object.entries(outputsByStockKey)) {
      const currentQuantity = Number(liveStockMap[stockKey]?.quantity || 0);
      const nextQuantity = currentQuantity + Number(outputGroup.totalQuantity || 0);
      const { error: upsertError } = await supabase.from("stock").upsert(
        [
          {
            company_id: productionOrder.company_id,
            position: outputGroup.position,
            material_code: outputGroup.material_code,
            quantity: nextQuantity
          }
        ],
        { onConflict: "company_id,position,material_code" }
      );
      if (upsertError) {
        setProductionError(upsertError.message || "Nepodarilo sa naskladniť výstup výroby.");
        setProductionCompletingId("");
        return;
      }
      liveStockMap[stockKey] = {
        company_id: productionOrder.company_id,
        position: outputGroup.position,
        material_code: outputGroup.material_code,
        quantity: nextQuantity
      };
    }

    const createdAtMs = Date.now();
    const historyNote = `Výrobná objednávka ${productionOrder.production_number} | ${productionOrder.title}`;
    const historyRows = [
      ...stockBoundInputs.flatMap((input) =>
        Array.from({ length: Math.max(1, Number(input.required_quantity || 0)) }, () => ({
          event_key: buildInventoryEventKey("production-issue"),
          company_id: productionOrder.company_id,
          action: "ISSUE",
          position: input.position,
          material_code: input.material_code,
          note: historyNote,
          created_at_ms: createdAtMs
        }))
      ),
      ...outputs.flatMap((output) =>
        Array.from({ length: Math.max(1, Number(output.output_quantity || 0)) }, () => ({
          event_key: buildInventoryEventKey("production-receive"),
          company_id: productionOrder.company_id,
          action: "RECEIVE",
          position: output.position,
          material_code: output.material_code,
          note: historyNote,
          created_at_ms: createdAtMs
        }))
      )
    ];

    const { error: historyInsertError } = await supabase.from("stock_history").insert(historyRows);
    if (historyInsertError) {
      setProductionError(historyInsertError.message || "Sklad sa upravil, ale nepodarilo sa zapísať históriu.");
      setProductionCompletingId("");
      return;
    }

    const completedAt = new Date().toISOString();
    const { error: productionUpdateError } = await supabase
      .from("production_orders")
      .update({ status: "completed", completed_at: completedAt, completed_by: authUser?.id || null })
      .eq("id", productionOrder.id);

    if (productionUpdateError) {
      setProductionError(productionUpdateError.message || "Sklad sa upravil, ale nepodarilo sa uzavrieť výrobnú objednávku.");
      setProductionCompletingId("");
      return;
    }

    setProductionCompletingId("");
    await loadProductionModuleData();
  };

  const handleOrderDraftItemChange = (index, field, value) => {
    setOrderDraftItems((prev) =>
      prev.map((item, currentIndex) => {
        if (currentIndex !== index) {
          return item;
        }

        if (field === "stockInput") {
          const matchedOption = resolveOrderStockOption(value, ordersStockOptions);
          return {
            ...item,
            stockInput: matchedOption ? matchedOption.label : value,
            stockKey: matchedOption ? matchedOption.stockKey : ""
          };
        }

        if (field === "stockKey") {
          const matchedOption = ordersStockOptions.find((option) => option.stockKey === value);
          return {
            ...item,
            stockKey: value,
            stockInput: matchedOption ? matchedOption.label : ""
          };
        }

        return { ...item, [field]: value };
      })
    );
  };

  const handleAddOrderDraftItem = () => {
    setOrderDraftItems((prev) => [...prev, createEmptyOrderDraftItem()]);
  };

  const handleRemoveOrderDraftItem = (index) => {
    setOrderDraftItems((prev) =>
      prev.length <= 1 ? [createEmptyOrderDraftItem()] : prev.filter((_, itemIndex) => itemIndex !== index)
    );
  };

  const handleCustomerNameInputChange = (value) => {
    setCustomerNameInput(value);
    setSelectedRegistryCompanyId("");
  };

  const handleSelectRegistryCompany = async (company) => {
    const companyId = String(company?.id || "").trim();
    if (!companyId) {
      return;
    }

    const requestId = companyLookupRequestRef.current + 1;
    companyLookupRequestRef.current = requestId;
    setCompanyLookupLoading(true);
    setCompanyLookupError("");

    try {
      const response = await noStoreFetch(`/api/v1/company-lookup?id=${encodeURIComponent(companyId)}`);
      const payload = await response.json();

      if (!response.ok || !payload?.ok || !payload?.item) {
        throw new Error(payload?.error || "Nepodarilo sa načítať detail firmy.");
      }

      if (companyLookupRequestRef.current !== requestId) {
        return;
      }

      setSelectedRegistryCompanyId(String(payload.item.id || companyId));
      setCustomerNameInput(String(payload.item.name || company.name || ""));
      setCustomerIcoInput(String(payload.item.ico || company.ico || ""));
      setCustomerDicInput(String(payload.item.dic || company.dic || ""));
      setCustomerAddressInput(String(payload.item.address?.formatted || ""));
      setCompanyLookupResults([]);
    } catch (lookupError) {
      if (companyLookupRequestRef.current === requestId) {
        setCompanyLookupError(lookupError?.message || "Nepodarilo sa načítať detail firmy.");
      }
    } finally {
      if (companyLookupRequestRef.current === requestId) {
        setCompanyLookupLoading(false);
      }
    }
  };

  const handleCreateCustomer = async (event) => {
    event.preventDefault();

    const companyId = activeCompanyId || userCompanyId;
    const name = String(customerNameInput || "").trim();
    if (!companyId) {
      setOrdersError("Vyber firmu pre zákazníka.");
      return;
    }
    if (!name) {
      setOrdersError("Zadaj názov zákazníka.");
      return;
    }

    setCustomerSubmitting(true);
    setOrdersError("");

    const { data, error: insertError } = await supabase
      .from("customers")
      .insert([
        {
          company_id: companyId,
          name,
          email: String(customerEmailInput || "").trim(),
          phone: String(customerPhoneInput || "").trim(),
          address: String(customerAddressInput || "").trim(),
          note: buildCustomerNotePayload(customerNoteInput, {
            ico: String(customerIcoInput || "").trim(),
            dic: String(customerDicInput || "").trim(),
            source: selectedRegistryCompanyId ? "RÚZ" : ""
          }),
          created_by: authUser?.id || null
        }
      ])
      .select("id,company_id,name,email,phone,address,note,created_at,created_by")
      .single();

    if (insertError) {
      setOrdersError(insertError.message || "Nepodarilo sa vytvoriť zákazníka.");
      setCustomerSubmitting(false);
      return;
    }

    setCustomers((prev) =>
      [...prev, data].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "sk-SK", { sensitivity: "base" }))
    );
    setSelectedOrderCustomerId(data.id);
    setCustomerNameInput("");
    setCustomerEmailInput("");
    setCustomerPhoneInput("");
    setCustomerAddressInput("");
    setCustomerIcoInput("");
    setCustomerDicInput("");
    setCustomerNoteInput("");
    setPriceListPurchaseInput("");
    setCompanyLookupResults([]);
    setCompanyLookupError("");
    setSelectedRegistryCompanyId("");
    setCustomerSubmitting(false);
  };

  const handleCreateOrder = async (event) => {
    event.preventDefault();

    const companyId = activeCompanyId || userCompanyId;
    const customer = customersById[selectedOrderCustomerId];
    if (!companyId) {
      setOrdersError("Vyber firmu pre objednávku.");
      return;
    }
    if (!customer) {
      setOrdersError("Vyber zákazníka.");
      return;
    }

    const normalizedItems = [];
    const quantityByKey = {};
    for (let index = 0; index < orderDraftItems.length; index += 1) {
      const item = orderDraftItems[index];
      const resolvedOption = ordersStockMap[item.stockKey]
        ? { stockKey: item.stockKey, row: ordersStockMap[item.stockKey] }
        : resolveOrderStockOption(item.stockInput, ordersStockOptions);
      const stockRow = resolvedOption?.row || null;
      const itemLabel = String(item.stockInput || stockRow?.material_code || "").trim();
      if (!itemLabel) {
        continue;
      }

      const orderedQuantity = Number.parseInt(String(item.orderedQuantity || "0"), 10);
      if (!Number.isFinite(orderedQuantity) || orderedQuantity < 1) {
        setOrdersError(`Zadaj platné množstvo pre ${itemLabel}.`);
        return;
      }

      if (!stockRow) {
        setOrdersError(`Položka ${index + 1} nie je spárovaná so skladom. Vyber návrh zo zoznamu alebo zadaj presný názov.`);
        return;
      }

      const resolvedStockKey = resolvedOption?.stockKey || item.stockKey;
      quantityByKey[resolvedStockKey] = (quantityByKey[resolvedStockKey] || 0) + orderedQuantity;
      normalizedItems.push({
        material_code: stockRow.material_code,
        position: stockRow.position,
        ordered_quantity: orderedQuantity,
        stock_quantity_snapshot: Number(stockRow.quantity || 0),
        line_note: String(item.lineNote || "").trim()
      });
    }

    if (normalizedItems.length === 0) {
      setOrdersError("Pridaj aspoň jednu skladovú položku.");
      return;
    }

    const invalidStock = Object.entries(quantityByKey).find(([stockKey, quantity]) => Number(quantity || 0) > Number(ordersStockMap[stockKey]?.quantity || 0));
    if (invalidStock) {
      const stockRow = ordersStockMap[invalidStock[0]];
      setOrdersError(`Objednané množstvo pre ${String(stockRow?.material_code || "-")} je vyššie ako stav skladu.`);
      return;
    }

    setOrderSubmitting(true);
    setOrdersError("");

    const { data: orderRow, error: orderInsertError } = await supabase
      .from("orders")
      .insert([
        {
          company_id: companyId,
          customer_id: customer.id,
          customer_name: customer.name,
          order_number: buildOrderNumber(),
          note: "",
          created_by: authUser?.id || null
        }
      ])
      .select("id,company_id,customer_id,customer_name,order_number,note,created_at,created_by")
      .single();

    if (orderInsertError) {
      setOrdersError(orderInsertError.message || "Nepodarilo sa vytvoriť objednávku.");
      setOrderSubmitting(false);
      return;
    }

    const { data: insertedItems, error: itemInsertError } = await supabase
      .from("order_items")
      .insert(normalizedItems.map((item) => ({ ...item, order_id: orderRow.id })))
      .select("id,order_id,material_code,position,ordered_quantity,stock_quantity_snapshot,line_note,created_at");

    if (itemInsertError) {
      setOrdersError(itemInsertError.message || "Objednávka sa vytvorila, ale položky sa nepodarilo uložiť.");
      setOrderSubmitting(false);
      await loadOrdersModuleData();
      return;
    }

    setOrders((prev) => [orderRow, ...prev]);
    setOrderItems((prev) => [...prev, ...(insertedItems || [])]);
    setExpandedOrders((prev) => ({ ...prev, [orderRow.id]: true }));
    resetOrderDraft();
    setOrderSubmitting(false);
  };

  const handlePrintOrder = (order) => {
    try {
      printOrderPdf(
        order,
        customersById[order.customer_id] || null,
        orderItemsByOrderId[order.id] || [],
        companyNameById[order.company_id] || activeCompany?.name || currentCompanyLabel
      );
    } catch (printError) {
      setOrdersError(printError?.message || "Nepodarilo sa vytvoriť PDF objednávky.");
    }
  };

  const handlePrintProductionOrder = (productionOrder) => {
    try {
      printProductionPdf(
        productionOrder,
        productionInputsByOrderId[productionOrder.id] || [],
        productionOutputsByOrderId[productionOrder.id] || [],
        companyNameById[productionOrder.company_id] || currentCompanyLabel
      );
    } catch (printError) {
      setProductionError(printError?.message || "Nepodarilo sa vytvoriť PDF výrobnej objednávky.");
    }
  };

  const fetchAllRows = async (table, config, options = {}) => {
    const { scopedCompanyId = null, selectClause = "*", historyFromMs = null } = options;
    const pageSize = 1000;
    let from = 0;
    let collected = [];

    while (true) {
      let query = supabase.from(table).select(selectClause).range(from, from + pageSize - 1);
      if (scopedCompanyId && isCompanyScopedTable(table)) {
        query = query.eq("company_id", scopedCompanyId);
      }
      if (historyFromMs && isTransactionsTable(table)) {
        query = query.gte("created_at_ms", historyFromMs);
      }

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
    const requestId = latestLoadRowsRequestRef.current + 1;
    latestLoadRowsRequestRef.current = requestId;
    const isLatestRequest = () => latestLoadRowsRequestRef.current === requestId;

    setLoading(true);
    setError("");

    try {
      let effectiveUserCompanyId = userCompanyId;
      if (!isMaster && !effectiveUserCompanyId && authUser?.id) {
        const resolvedCompanyId = await fetchOwnCompanyIdViaRpc(authUser.id);
        if (resolvedCompanyId) {
          effectiveUserCompanyId = resolvedCompanyId;
          if (!isLatestRequest()) {
            return;
          }
          setUserCompanyId(resolvedCompanyId);
          setSelectedCompanyId(resolvedCompanyId);
        }
      }

      const companyScope = isMaster ? selectedCompanyId : effectiveUserCompanyId;
      const scopedCompanyId = companyScope && companyScope !== "all" ? companyScope : null;
      // For non-master users, do not hard-block when local company state is missing.
      // RLS safely scopes rows by auth.uid() on the backend.

      const sourceTable = isDailyOverviewTable(table) ? TRANSACTIONS_TABLE : table;
      const config = getTableConfig(table);
      const stockSelectClause = `company_id,position,material_code,quantity${showsExpiryDate ? ",expiry_date" : ""}`;
      const data =
        sourceTable === "stock"
          ? await fetchAllRows(sourceTable, config, {
              scopedCompanyId,
              selectClause: stockSelectClause
            })
          : await fetchAllRows(sourceTable, config, {
              scopedCompanyId,
              historyFromMs: isDailyOverviewTable(table) ? getStartOfTodayMs() : null
            });
      const normalizedData =
        sourceTable === PRICE_LIST_TABLE ? (data || []).map((row) => buildPriceListComputedRow(row)) : data || [];
      if (!isLatestRequest()) {
        return;
      }
      setRows(normalizedData);

      const stockRows =
        sourceTable === "stock"
          ? data || []
          : await fetchAllRows("stock", getTableConfig("stock"), {
              scopedCompanyId,
              selectClause: stockSelectClause
            });
      if (!isLatestRequest()) {
        return;
      }
      setStockSnapshotRows(stockRows || []);

      if (sourceTable !== "stock" && !isDailyOverviewTable(table)) {
        setDeadStockByKey({});
        setStockAgeStats({ avgDays: null, sampleCount: 0 });
        setOccupancySeries([]);
        return;
      }

      const historyRows = await fetchAllRows(TRANSACTIONS_TABLE, getTableConfig(TRANSACTIONS_TABLE), {
        scopedCompanyId,
        selectClause: "company_id,action,position,material_code,created_at_ms",
        historyFromMs: Date.now() - HISTORY_ANALYTICS_LOOKBACK_DAYS * DAY_MS
      });
      if (!isLatestRequest()) {
        return;
      }
      const now = Date.now();
      const deadStockMs = deadStockDays * 24 * 60 * 60 * 1000;
      const latestMovementMsByKey = {};
      const latestInboundMsByKey = {};
      const latestAnyMsByKey = {};

      for (const historyRow of historyRows) {
        const key = makeStockKey(historyRow.position, historyRow.material_code, historyRow.company_id);
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

        const latestAny = latestAnyMsByKey[key];
        if (!Number.isFinite(latestAny) || createdAtMs > latestAny) {
          latestAnyMsByKey[key] = createdAtMs;
        }

        if (INBOUND_ACTIONS.has(String(historyRow.action || "").toUpperCase())) {
          const latestInbound = latestInboundMsByKey[key];
          if (!Number.isFinite(latestInbound) || createdAtMs > latestInbound) {
            latestInboundMsByKey[key] = createdAtMs;
          }
        }
      }

      const deadMap = {};
      let ageTotalMs = 0;
      let ageSamples = 0;
      for (const stockRow of stockRows || []) {
        const quantity = Number(stockRow.quantity || 0);
        if (!(quantity > 0)) {
          continue;
        }

        const key = makeStockKey(stockRow.position, stockRow.material_code, stockRow.company_id);
        const lastMoveMs = latestMovementMsByKey[key];
        const inactiveMs = Number.isFinite(lastMoveMs) ? now - lastMoveMs : Number.POSITIVE_INFINITY;
        const referenceMs = latestInboundMsByKey[key] ?? latestAnyMsByKey[key];
        if (Number.isFinite(referenceMs) && now >= referenceMs) {
          ageTotalMs += now - referenceMs;
          ageSamples += 1;
        }

        if (inactiveMs < deadStockMs) {
          continue;
        }

        deadMap[key] = {
          inactiveDays: Number.isFinite(inactiveMs) ? Math.floor(inactiveMs / DAY_MS) : null,
          lastMoveMs: Number.isFinite(lastMoveMs) ? lastMoveMs : null
        };
      }
      if (!isLatestRequest()) {
        return;
      }
      setDeadStockByKey(deadMap);
      setStockAgeStats({
        avgDays: ageSamples > 0 ? ageTotalMs / ageSamples / DAY_MS : null,
        sampleCount: ageSamples
      });
      if (!isMaster) {
        const chartSeries = buildOccupancySeries(historyRows, {
          range: occupancyChartRange,
          maxPositions: effectiveMaxPositions,
          isMaster,
          selectedCompanyId
        });
        setOccupancySeries(chartSeries);
      } else {
        setOccupancySeries([]);
      }
    } catch (queryError) {
      if (!isLatestRequest()) {
        return;
      }
      const loadErrorMessage = queryError?.message || "Nepodarilo sa načítať dáta.";
      setError(loadErrorMessage);
      setRows([]);
      setStockSnapshotRows([]);
      setDeadStockByKey({});
      setStockAgeStats({ avgDays: null, sampleCount: 0 });
      setOccupancySeries([]);
    } finally {
      if (isLatestRequest()) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    window.localStorage.setItem("wms_dead_stock_days", String(deadStockDays));
  }, [deadStockDays]);

  useEffect(() => {
    let mounted = true;
    let hydrationSequence = 0;
    const clearInitTimeout = () => {
      window.clearTimeout(initTimeout);
    };
    const initTimeout = window.setTimeout(() => {
      if (!mounted) {
        return;
      }
      setAuthInitTimedOut(true);
      setAuthError((prev) => prev || "Auth init timeout. Skontroluj Vercel env a Supabase dostupnosť.");
    }, AUTH_INIT_TIMEOUT_MS);

    const hydrateFromSession = async (session) => {
      const currentHydrationId = hydrationSequence + 1;
      hydrationSequence = currentHydrationId;
      const user = session?.user || null;
      const jwtClaims = decodeJwtClaims(session?.access_token);
      if (!mounted || currentHydrationId !== hydrationSequence) {
        return;
      }

      clearInitTimeout();
      setAuthError("");
      setIsLoggedIn(Boolean(user));
      setAuthUser(user);
      if (!user) {
        setUserRole("user");
        setAuthUsername("");
        setUserCompanyId(null);
        setCanManageOrders(false);
        setSelectedCompanyId("all");
      } else {
        const fallbackUsername = usernameFromInternalEmail(user.email);
        const claimedRoleRaw = String(jwtClaims?.app_role || "").toLowerCase();
        const claimedRole = claimedRoleRaw === "master" ? "master" : "";
        const claimedCompanyId = String(jwtClaims?.company_id || "").trim() || null;

        setUserRole(claimedRole || "user");
        setAuthUsername(String(fallbackUsername || ""));
        setUserCompanyId(claimedCompanyId);
        setCanManageOrders(claimedRole === "master");
        if (claimedRole !== "master") {
          setSelectedCompanyId(claimedCompanyId || "");
        }

        try {
          const [resolvedRole, dbMasterFlag, companyFromRpc] = await Promise.all([
            resolveUserRole(user),
            fetchDbMasterFlagViaRpc(user.id),
            fetchOwnCompanyIdViaRpc(user.id)
          ]);
          if (!mounted || currentHydrationId !== hydrationSequence) {
            return;
          }
          const role = claimedRole || (resolvedRole === "master" || dbMasterFlag ? "master" : "user");
          setUserRole(role);
          if (role === "master") {
            await ensureOwnRoleRow(user, role);
          }
          const ownRow = await fetchOwnRoleRow(user.id);
          if (!mounted || currentHydrationId !== hydrationSequence) {
            return;
          }
          setAuthUsername(String(ownRow?.username || usernameFromInternalEmail(ownRow?.email) || fallbackUsername || ""));
          const resolvedCompanyId = claimedCompanyId || ownRow?.company_id || companyFromRpc || null;
          setUserCompanyId(resolvedCompanyId);
          setCanManageOrders(role === "master" ? true : Boolean(ownRow?.can_manage_orders));
          if (role !== "master") {
            setSelectedCompanyId(resolvedCompanyId || "");
          }
        } catch (profileError) {
          if (!mounted || currentHydrationId !== hydrationSequence) {
            return;
          }
          setAuthError((prev) => prev || `Profil sa načítal len čiastočne: ${profileError?.message || "neznáma chyba"}`);
        }
      }
      setAuthReady(true);
      setAuthInitTimedOut(false);
    };

    const init = async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }
        await hydrateFromSession(data?.session || null);
      } catch (initError) {
        if (!mounted) {
          return;
        }
        clearInitTimeout();
        if (isRecoverableAuthStateError(initError)) {
          await recoverBrokenLocalAuthState();
        }
        setIsLoggedIn(false);
        setAuthUser(null);
        setUserRole("user");
        setAuthUsername("");
        setCanManageOrders(false);
        setAuthReady(true);
        setAuthInitTimedOut(true);
        setAuthError(
          `Auth init failed: ${
            initError?.message || "Skontroluj VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY vo Verceli."
          }`
        );
      }
    };

    init();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        if (!mounted) {
          return;
        }
        hydrateFromSession(session || null).catch((stateError) => {
          if (!mounted) {
            return;
          }
          setAuthReady(true);
          setAuthError(`Auth state error: ${stateError?.message || "neznáma chyba"}`);
        });
      }, 0);
    });

    return () => {
      mounted = false;
      clearInitTimeout();
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) {
      return undefined;
    }

    if (!isLoggedIn) {
      setRows([]);
      setStockSnapshotRows([]);
      setCustomers([]);
      setOrders([]);
      setOrderItems([]);
      setOrdersStockRows([]);
      setProductionOrders([]);
      setProductionOrderInputs([]);
      setProductionOrderOutputs([]);
      setProductionStockRows([]);
      setProductionError("");
      setProductionLoading(false);
      setCompanyLookupResults([]);
      setCompanyLookupLoading(false);
      setCompanyLookupError("");
      setSelectedRegistryCompanyId("");
      setLoading(false);
      return undefined;
    }

    if (isOrdersModule(selectedTable)) {
      setRows([]);
      setStockSnapshotRows([]);
      setDeadStockByKey({});
      setStockAgeStats({ avgDays: null, sampleCount: 0 });
      setOccupancySeries([]);
      setLoading(false);
      loadOrdersModuleData();

      let reloadTimer = null;
      const scheduleReload = () => {
        if (reloadTimer) {
          window.clearTimeout(reloadTimer);
        }
        reloadTimer = window.setTimeout(() => loadOrdersModuleData(), 350);
      };

      const channel = supabase.channel(`orders-${selectedCompanyId || userCompanyId || "own"}`);
      ["customers", "orders", "order_items", "stock"].forEach((table) => {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleReload);
      });
      channel.subscribe();

      return () => {
        if (reloadTimer) {
          window.clearTimeout(reloadTimer);
        }
        supabase.removeChannel(channel);
      };
    }

    if (isProductionModule(selectedTable)) {
      setRows([]);
      setStockSnapshotRows([]);
      setDeadStockByKey({});
      setStockAgeStats({ avgDays: null, sampleCount: 0 });
      setOccupancySeries([]);
      setLoading(false);
      loadProductionModuleData();

      let reloadTimer = null;
      const scheduleReload = () => {
        if (reloadTimer) {
          window.clearTimeout(reloadTimer);
        }
        reloadTimer = window.setTimeout(() => loadProductionModuleData(), 350);
      };

      const channel = supabase.channel(`production-${selectedCompanyId || userCompanyId || "own"}`);
      ["production_orders", "production_order_inputs", "production_order_outputs", "stock", "stock_history"].forEach((table) => {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleReload);
      });
      channel.subscribe();

      return () => {
        if (reloadTimer) {
          window.clearTimeout(reloadTimer);
        }
        supabase.removeChannel(channel);
      };
    }

    setStatusFilter("all");
    setSearchTerm("");
    setShowDeadStockOnly(false);
    setExpandedPositions({});
    loadRows(selectedTable);
    let reloadTimer = null;
    const scheduleReload = () => {
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
      reloadTimer = window.setTimeout(() => loadRows(selectedTable), 350);
    };

    const channel = supabase.channel(`monitor-${selectedTable}`);
    channel.on("postgres_changes", { event: "*", schema: "public", table: selectedTable }, scheduleReload);
    if (selectedTable === "stock") {
      channel.on("postgres_changes", { event: "*", schema: "public", table: TRANSACTIONS_TABLE }, scheduleReload);
    }
    channel.subscribe();

    return () => {
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
      supabase.removeChannel(channel);
    };
  }, [selectedTable, isLoggedIn, deadStockDays, authReady, selectedCompanyId, userCompanyId, isMaster, authUser?.id, occupancyChartRange, effectiveMaxPositions, activeCompany?.tracks_expiry_date, canAccessOrdersModule]);

  useEffect(() => {
    if (!authReady || !isLoggedIn) {
      return undefined;
    }

    if (isOrdersModule(selectedTable)) {
      const intervalId = window.setInterval(() => {
        loadOrdersModuleData();
      }, AUTO_REFRESH_MS);

      return () => {
        window.clearInterval(intervalId);
      };
    }

    if (isProductionModule(selectedTable)) {
      const intervalId = window.setInterval(() => {
        loadProductionModuleData();
      }, AUTO_REFRESH_MS);

      return () => {
        window.clearInterval(intervalId);
      };
    }

    const intervalId = window.setInterval(() => {
      loadRows(selectedTable);
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoggedIn, selectedTable, deadStockDays, authReady, selectedCompanyId, userCompanyId, isMaster, authUser?.id, occupancyChartRange, effectiveMaxPositions, activeCompany?.tracks_expiry_date, canAccessOrdersModule]);

  useEffect(() => {
    if (!authReady || !isLoggedIn) {
      setManagedUsers([]);
      return;
    }

    if (isMaster) {
      loadManagedUsers();
    } else {
      setManagedUsers([]);
    }
    loadCompanies();
  }, [authReady, isLoggedIn, isMaster, authUser?.id]);

  useEffect(() => {
    loadMaterialSubscriptions();
  }, [authReady, isLoggedIn, selectedTable, activeCompanyId, selectedCompanyId, isMaster, userCompanyId, rows]);

  useEffect(() => {
    if (selectedTable !== PRICE_LIST_TABLE) {
      setPriceListFormError("");
      return;
    }

    resetPriceListForm();
  }, [selectedTable, activeCompanyId]);

  useEffect(() => {
    if (!visibleTableNames.includes(selectedTable)) {
      setSelectedTable(visibleTableNames[0] || "stock");
    }
  }, [visibleTableNames, selectedTable]);

  const statuses = useMemo(() => {
    if (effectiveTableConfig.statusKeys.length === 0) {
      return ["all"];
    }

    const unique = new Set(
      rows
        .map((row) => pickValue(row, effectiveTableConfig.statusKeys))
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
    );

    return ["all", ...Array.from(unique)];
  }, [rows, effectiveTableConfig.statusKeys]);

  const filteredRows = useMemo(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase();
    const compactTerm = normalizeForSearch(searchTerm.trim());

    return rows.filter((row) => {
      if (selectedTable === "stock" && showDeadStockOnly) {
        const rowKey = makeStockKey(row.position, row.material_code, row.company_id);
        if (!deadStockByKey[rowKey]) {
          return false;
        }
      }

      const matchesStatus =
        statusFilter === "all" ||
        String(pickValue(row, effectiveTableConfig.statusKeys) || "").toLowerCase() === statusFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!normalizedTerm) {
        return true;
      }

      const searchKeys =
        effectiveTableConfig.searchKeys && effectiveTableConfig.searchKeys.length > 0
          ? effectiveTableConfig.searchKeys
          : effectiveTableConfig.columns.flatMap((column) => column.keys);

      return searchKeys.some((key) => {
        const rawValue = String(row[key] ?? "");
        const plainMatch = rawValue.toLowerCase().includes(normalizedTerm);
        if (plainMatch) {
          return true;
        }

        if (key !== "material_code" || compactTerm.length < 5) {
          return false;
        }

        // For material search, allow matching by any 5+ consecutive chars even with separators in source code.
        return normalizeForSearch(rawValue).includes(compactTerm);
      });
    });
  }, [rows, statusFilter, searchTerm, tableConfig, selectedTable, showDeadStockOnly, deadStockByKey]);

  const lastTimestamp = useMemo(() => {
    if (effectiveTableConfig.timeKeys.length === 0) {
      return "-";
    }

    const candidate = rows
      .map((row) => pickValue(row, effectiveTableConfig.timeKeys))
      .find((value) => value !== null && value !== undefined);

    return candidate ? formatDate(candidate) : "-";
  }, [rows, effectiveTableConfig.timeKeys]);

  useEffect(() => {
    setCompanySettingsError("");
    setCompanyMaxPositionsInput(String(normalizeMaxPositions(activeCompany?.max_positions ?? ENV_DEFAULT_MAX_POSITIONS)));
    setCompanyTracksExpiryDateInput(Boolean(activeCompany?.tracks_expiry_date));
  }, [activeCompany?.id, activeCompany?.max_positions, activeCompany?.tracks_expiry_date]);

  const filteredManagedUsers = useMemo(() => {
    const normalizedSearch = String(masterUserSearch || "").trim().toLowerCase();
    return managedUsers.filter((row) => {
      if (masterUserCompanyFilter !== "all") {
        if (masterUserCompanyFilter === "__masters__") {
          if (row.role !== "master") {
            return false;
          }
        } else if ((row.company_id || "") !== masterUserCompanyFilter) {
          return false;
        }
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        row.username,
        row.email,
        row.user_id,
        row.role,
        row.company_id ? companyNameById[row.company_id] : ""
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return haystack.includes(normalizedSearch);
    });
  }, [managedUsers, masterUserSearch, masterUserCompanyFilter, companyNameById]);

  const metricValue = useMemo(() => effectiveTableConfig.metricValue(rows), [rows, effectiveTableConfig]);
  const issueCount = useMemo(() => {
    if (!isTransactionsTable(selectedTable)) {
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
      const companyPart =
        isMaster && selectedCompanyId === "all" ? `${companyNameById[row.company_id] || "Firma"} | ` : "";
      const position = `${companyPart}${String(row.position || "-").trim() || "-"}`;
      const quantity = Number(row.quantity || 0);
      const stockKey = makeStockKey(row.position, row.material_code, row.company_id);

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
  }, [filteredRows, selectedTable, deadStockByKey, isMaster, selectedCompanyId, companyNameById]);
  const positionUsageMap = useMemo(() => {
    if (selectedTable !== "stock") {
      return {};
    }

    const usage = {};
    for (const row of rows) {
      const rawPosition = String(row.position || "").trim();
      const companyPrefix =
        isMaster && selectedCompanyId === "all" ? `${companyNameById[row.company_id] || "Firma"} | ` : "";
      const positionKey = `${companyPrefix}${rawPosition}`;
      if (!positionKey) {
        continue;
      }
      usage[positionKey] = (usage[positionKey] || 0) + 1;
    }
    return usage;
  }, [rows, selectedTable, isMaster, selectedCompanyId, companyNameById]);
  const occupiedPositions = useMemo(() => {
    const sourceRows = selectedTable === "stock" ? rows : isDailyOverviewTable(selectedTable) ? stockSnapshotRows : [];
    if (sourceRows.length === 0) {
      return 0;
    }
    return new Set(
      sourceRows
        .map((row) => {
          const position = String(row.position || "").trim();
          if (!position) {
            return "";
          }
          return isMaster && selectedCompanyId === "all" ? `${row.company_id}::${position}` : position;
        })
        .filter(Boolean)
    ).size;
  }, [rows, stockSnapshotRows, selectedTable, isMaster, selectedCompanyId]);
  const freePositions = useMemo(
    () => Math.max(0, effectiveMaxPositions - occupiedPositions),
    [effectiveMaxPositions, occupiedPositions]
  );
  const occupancyPercent = useMemo(
    () => (occupiedPositions / effectiveMaxPositions) * 100,
    [occupiedPositions, effectiveMaxPositions]
  );
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
  const occupancyChartMaxPercent = useMemo(() => {
    const maxInSeries = occupancySeries.reduce((max, point) => Math.max(max, Number(point.percent || 0)), 0);
    return Math.max(100, Math.ceil(maxInSeries / 10) * 10);
  }, [occupancySeries]);
  const occupancyChartPolyline = useMemo(() => {
    if (occupancySeries.length === 0) {
      return "";
    }
    const width = 100;
    const height = 100;
    return occupancySeries
      .map((point, index) => {
        const x = occupancySeries.length === 1 ? 0 : (index / (occupancySeries.length - 1)) * width;
        const normalized = Math.min(occupancyChartMaxPercent, Math.max(0, Number(point.percent || 0)));
        const y = height - (normalized / occupancyChartMaxPercent) * height;
        return `${x},${y}`;
      })
      .join(" ");
  }, [occupancySeries, occupancyChartMaxPercent]);
  const availableMaterialSuggestions = useMemo(() => {
    if (selectedTable !== "stock") {
      return [];
    }

    return Array.from(
      new Set(
        rows
          .map((row) => String(row.material_code || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "sk-SK", { sensitivity: "base" }));
  }, [rows, selectedTable]);
  const hasActiveFilters =
    statusFilter !== "all" || searchTerm.trim().length > 0 || (selectedTable === "stock" && showDeadStockOnly);
  const dailyOverviewStats = useMemo(() => {
    if (!isDailyOverviewTable(selectedTable)) {
      return null;
    }

    const actionCounts = { receive: 0, issue: 0, move: 0, adjust: 0, other: 0 };
    const materials = new Set();
    const positions = new Set();
    const currentHour = new Date().getHours();
    const hourlyBuckets = Array.from({ length: currentHour + 1 }, (_, hour) => ({ hour, count: 0 }));

    for (const row of rows) {
      const action = String(row.action || "").toUpperCase();
      if (action === "RECEIVE") {
        actionCounts.receive += 1;
      } else if (action === "ISSUE") {
        actionCounts.issue += 1;
      } else if (action === "MOVE" || action === "MOVE_ALL") {
        actionCounts.move += 1;
      } else if (action === "ADJUST") {
        actionCounts.adjust += 1;
      } else {
        actionCounts.other += 1;
      }

      if (row.material_code) {
        materials.add(String(row.material_code));
      }
      if (row.position) {
        positions.add(String(row.position));
      }

      const createdAt = Number(row.created_at_ms);
      if (Number.isFinite(createdAt)) {
        const hour = new Date(createdAt).getHours();
        if (hourlyBuckets[hour]) {
          hourlyBuckets[hour].count += 1;
        }
      }
    }

    const busiestBucket = hourlyBuckets.reduce((best, current) => (current.count > best.count ? current : best), hourlyBuckets[0]);
    const recentRows = [...rows]
      .sort((a, b) => Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0))
      .slice(0, 8);

    return {
      ...actionCounts,
      uniqueMaterials: materials.size,
      activePositions: positions.size,
      busiestHourLabel: busiestBucket.count > 0 ? `${String(busiestBucket.hour).padStart(2, "0")}:00` : "-",
      busiestHourCount: busiestBucket.count,
      currentHourLabel: `${String(currentHour).padStart(2, "0")}:00`,
      hourlyBuckets,
      recentRows
    };
  }, [rows, selectedTable]);
  const currentCompanyLabel = useMemo(() => {
    if (isMaster) {
      return selectedCompanyId === "all" ? "Všetky firmy" : companyNameById[selectedCompanyId] || "Firma";
    }
    return companyNameById[userCompanyId] || "Bez firmy";
  }, [isMaster, selectedCompanyId, companyNameById, userCompanyId]);
  const filteredOrders = useMemo(() => {
    const normalized = String(orderSearchTerm || "").trim().toLowerCase();
    if (!normalized) {
      return orders;
    }
    return orders.filter((order) =>
      [order.order_number, order.customer_name, order.note]
        .some((value) => String(value || "").toLowerCase().includes(normalized))
    );
  }, [orders, orderSearchTerm]);
  const filteredProductionOrders = useMemo(() => {
    const normalized = String(productionSearchTerm || "").trim().toLowerCase();
    if (!normalized) {
      return productionOrders;
    }
    return productionOrders.filter((order) =>
      [order.production_number, order.title, order.status, order.note]
        .some((value) => String(value || "").toLowerCase().includes(normalized))
    );
  }, [productionOrders, productionSearchTerm]);
  const sidebarSections = useMemo(() => {
    const monitoringItems = visibleTableNames.filter(
      (table) => !isOrdersModule(table) && !isProductionModule(table) && table !== PRICE_LIST_TABLE
    );
    const sections = [
      {
        title: isMaster ? "Dáta" : "Monitoring",
        items: monitoringItems
      }
    ];

    if (visibleTableNames.includes(ORDERS_MODULE) || visibleTableNames.includes(PRICE_LIST_TABLE)) {
      sections.push({
        title: "Workflow",
        items: [ORDERS_MODULE, PRODUCTION_MODULE, PRICE_LIST_TABLE].filter((table) => visibleTableNames.includes(table))
      });
    }

    return sections;
  }, [visibleTableNames, isMaster, selectedTable]);

  useEffect(() => {
    const query = String(customerNameInput || "").trim();

    if (!canAccessOrdersModule || isLoggedIn === false) {
      setCompanyLookupResults([]);
      setCompanyLookupLoading(false);
      setCompanyLookupError("");
      return undefined;
    }

    if (selectedRegistryCompanyId && query.length > 0) {
      setCompanyLookupResults([]);
      setCompanyLookupLoading(false);
      setCompanyLookupError("");
      return undefined;
    }

    if (query.length < 3) {
      setCompanyLookupResults([]);
      setCompanyLookupLoading(false);
      setCompanyLookupError("");
      return undefined;
    }

    const requestId = companyLookupRequestRef.current + 1;
    companyLookupRequestRef.current = requestId;
    const timerId = window.setTimeout(async () => {
      setCompanyLookupLoading(true);
      setCompanyLookupError("");

      try {
        const response = await noStoreFetch(`/api/v1/company-lookup?q=${encodeURIComponent(query)}&limit=6`);
        const payload = await response.json();

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Nepodarilo sa vyhľadať firmu.");
        }

        if (companyLookupRequestRef.current !== requestId) {
          return;
        }

        setCompanyLookupResults(Array.isArray(payload.items) ? payload.items : []);
      } catch (lookupError) {
        if (companyLookupRequestRef.current === requestId) {
          setCompanyLookupResults([]);
          setCompanyLookupError(lookupError?.message || "Nepodarilo sa vyhľadať firmu.");
        }
      } finally {
        if (companyLookupRequestRef.current === requestId) {
          setCompanyLookupLoading(false);
        }
      }
    }, COMPANY_LOOKUP_DEBOUNCE_MS);

    return () => window.clearTimeout(timerId);
  }, [customerNameInput, selectedRegistryCompanyId, canAccessOrdersModule, isLoggedIn]);

  useEffect(() => {
    if (hotjarAllowed) {
      installHotjar();
      return undefined;
    }

    uninstallHotjar();
    return undefined;
  }, [hotjarAllowed]);

  useEffect(() => {
    const siteUrl = resolveSiteUrl();
    const canonicalUrl = siteUrl ? `${siteUrl}/` : "/";
    const publicView = !isLoggedIn;
    const pendingAuthCheck = !authReady && !authInitTimedOut;
    const pageTitle = pendingAuthCheck ? `Overenie relácie | ${SITE_NAME}` : publicView ? LANDING_TITLE : `${tableConfig.title} | ${SITE_NAME}`;
    const pageDescription = publicView
      ? LANDING_DESCRIPTION
      : `${tableConfig.subtitle}. Interná WMS aplikácia pre monitoring zásob, pohybov a kapacity skladu.`;
    const robotsDirective = publicView && !pendingAuthCheck ? "index, follow" : "noindex, nofollow";
    const shareImage = siteUrl ? `${siteUrl}/logo.png` : "/logo.png";

    document.title = pageTitle;
    upsertMetaTag("name", "description", pageDescription);
    upsertMetaTag("name", "robots", robotsDirective);
    upsertMetaTag("property", "og:title", pageTitle);
    upsertMetaTag("property", "og:description", pageDescription);
    upsertMetaTag("property", "og:type", "website");
    upsertMetaTag("property", "og:url", canonicalUrl);
    upsertMetaTag("property", "og:image", shareImage);
    upsertMetaTag("name", "twitter:title", pageTitle);
    upsertMetaTag("name", "twitter:description", pageDescription);
    upsertMetaTag("name", "twitter:image", shareImage);
    upsertLinkTag("canonical", canonicalUrl);
  }, [authReady, authInitTimedOut, isLoggedIn, tableConfig.title, tableConfig.subtitle]);

  const togglePositionExpanded = (position) => {
    setExpandedPositions((prev) => ({ ...prev, [position]: !prev[position] }));
  };

  const exportToExcel = () => {
    const headers = effectiveTableConfig.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    const body = filteredRows
      .map((row) => {
        const cols = effectiveTableConfig.columns
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

  const handleGenerateQrLabels = (event) => {
    event.preventDefault();
    setQrGeneratorError("");

    const prefix = String(qrRackPrefix || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const rows = Number.parseInt(String(qrRowCount || "0"), 10);
    const columns = Number.parseInt(String(qrColumnCount || "0"), 10);

    if (!prefix) {
      setQrGeneratorError("Zadaj názov regálu, napr. A.");
      return;
    }

    if (!Number.isFinite(rows) || rows < 1) {
      setQrGeneratorError("Počet riadkov musí byť aspoň 1.");
      return;
    }

    if (!Number.isFinite(columns) || columns < 1) {
      setQrGeneratorError("Počet stĺpcov musí byť aspoň 1.");
      return;
    }

    const codes = buildRackLocationCodes(prefix, rows, columns);
    try {
      printQrLabels(codes, resolvePrintableAssetUrl(logo));
    } catch (printError) {
      setQrGeneratorError(printError?.message || "Nepodarilo sa pripraviť QR štítky na tlač.");
    }
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError("");
    setAuthInitTimedOut(false);
    setAuthReady(true);
    const email = resolveLoginEmail(authUsernameInput);

    if (!email) {
      setAuthError("Zadaj platný login.");
      setAuthSubmitting(false);
      return;
    }

    try {
      clearSupabaseAuthStorage();
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Ignore local sign-out cleanup failure before fresh login.
    }

    let { error: signInError } = await supabase.auth.signInWithPassword({ email, password: authPassword });

    if (signInError && isRecoverableAuthStateError(signInError)) {
      await recoverBrokenLocalAuthState();
      ({ error: signInError } = await supabase.auth.signInWithPassword({ email, password: authPassword }));
    }

    if (signInError) {
      setAuthError(signInError.message || "Prihlásenie zlyhalo. Skontroluj login a heslo.");
      setAuthSubmitting(false);
      return;
    }

    setAuthSubmitting(false);
    setAuthPassword("");
  };

  const handleSignOut = async () => {
    setSignOutSubmitting(true);
    setAuthError("");
    // Optimistic local logout so UI never gets stuck on a broken auth callback/network.
    setIsLoggedIn(false);
    setAuthUser(null);
    setUserRole("user");
    setUserCompanyId(null);
    setCanManageOrders(false);
    setSelectedCompanyId("all");
    setRows([]);
    setError("");
    setLoading(false);
    setCustomers([]);
    setOrders([]);
    setOrderItems([]);
    setOrdersStockRows([]);
    setOrdersError("");
    setProductionOrders([]);
    setProductionOrderInputs([]);
    setProductionOrderOutputs([]);
    setProductionStockRows([]);
    setProductionError("");
    setProductionLoading(false);
    setProductionTitleInput("");
    setProductionSearchTerm("");
    setProductionDraftInputs([createEmptyProductionInputDraft()]);
    setProductionDraftOutputs([createEmptyProductionOutputDraft()]);
    setProductionSubmitting(false);
    setProductionCompletingId("");
    setExpandedProductionOrders({});
    setCustomerNameInput("");
    setCustomerEmailInput("");
    setCustomerPhoneInput("");
    setCustomerAddressInput("");
    setCustomerIcoInput("");
    setCustomerDicInput("");
    setCustomerNoteInput("");
    setCompanyLookupResults([]);
    setCompanyLookupLoading(false);
    setCompanyLookupError("");
    setSelectedRegistryCompanyId("");
    setManagedUsers([]);
    setCompanies([]);
    setManagedUsersError("");
    setAuthUsername("");
    setAuthPassword("");

    try {
      try {
        await supabase.removeAllChannels();
      } catch {
        // Ignore realtime cleanup failures on logout.
      }
      await supabase.auth.signOut();
      await userCreatorClient.auth.signOut();
    } catch (signOutError) {
      setAuthError(signOutError?.message || "Odhlásenie lokálne prebehlo, serverové odhlásenie zlyhalo.");
    } finally {
      setMaterialSubscriptions([]);
      setMaterialSubscriptionsError("");
      setSubscriptionMaterialInput("");
      setSubscriptionEmailInput("");
      setIsMaterialSubscriptionOpen(false);
      resetPriceListForm();
      setPriceListSubmitting(false);
      setPriceListDeleting(false);
      setPriceListImportSubmitting(false);
      setSignOutSubmitting(false);
    }
  };

  if (!authReady && !authInitTimedOut) {
    return (
      <main className="container">
        <section className="panel">
          <p className="hint">Overujem reláciu...</p>
          <button
            type="button"
            className="refresh-btn"
            onClick={() => {
              setAuthReady(true);
              setAuthInitTimedOut(true);
              setIsLoggedIn(false);
              setAuthError((prev) => prev || "Reláciu sa nepodarilo overiť. Pokračuj cez nové prihlásenie.");
            }}
          >
            Pokračovať na login
          </button>
        </section>
      </main>
    );
  }

  if (!isLoggedIn) {
    return (
      <main className="container landing-screen">
        <section className="landing-layout">
          <article className="landing-card">
            <img src={logo} alt="WMS Online" className="landing-logo" />
            <p className="landing-tag">WMS Online</p>
            <h1>Skladový monitoring a online prehľad zásob na jednom mieste</h1>
            <p className="subtitle">
              Sleduj zásoby, evidenciu skladových pohybov, príjmy, výdaje a presuny v jednej aplikácii s okamžitou
              aktualizáciou dát.
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
            <p className="subtitle">Prihlás sa loginom a heslom.</p>
            <form className="login-form" onSubmit={handleSignIn}>
              <label className="login-label" htmlFor="username">
                Login
              </label>
              <input
                id="username"
                type="text"
                className="search-input"
                value={authUsernameInput}
                onChange={(event) => setAuthUsernameInput(event.target.value)}
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
        <section className="landing-supporting" aria-label="Informácie o riešení WMS Online">
          <article className="landing-card seo-section">
            <h2>Skladový monitoring a evidencia skladových pohybov</h2>
            <p>
              WMS Online pomáha sledovať skladové zásoby, pohyby materiálu a obsadenosť pozícií v reálnom čase. Je
              vhodný pre firmy, ktoré chcú mať online prehľad zásob, znížiť manuálne reportovanie a zrýchliť prácu
              operatívy aj manažmentu.
            </p>
          </article>
          <article className="landing-card seo-section">
            <h2>Pre koho je skladový monitoring vhodný</h2>
            <ul className="landing-list seo-list">
              {LANDING_USE_CASES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="landing-card seo-section">
            <h2>Časté otázky</h2>
            <div className="faq-list">
              {LANDING_FAQ.map((item) => (
                <details key={item.question} className="faq-item">
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="container dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="brand">
            <img src={logo} alt="Logo" className="brand-logo" />
          </div>
          <div>
            <strong>WMS Online</strong>
            <p>Interný skladový cockpit</p>
          </div>
        </div>

        <div className="sidebar-user-card">
          <span className="table-badge">{authUsername || "user"}</span>
          <span className="table-badge">{currentCompanyLabel}</span>
          {isMaster && <span className="table-badge table-badge-master">master</span>}
        </div>

        {isMaster && (
          <label className="sidebar-company-switch">
            <span>Firma</span>
            <select value={selectedCompanyId} onChange={(event) => handleCompanyScopeChange(event.target.value)}>
              <option value="all">Všetky firmy</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <nav className="sidebar-nav" aria-label="Hlavná navigácia">
          {sidebarSections.map((section) => (
            <section key={section.title} className="sidebar-section">
              <p className="sidebar-section-title">{section.title}</p>
              <div className="sidebar-tree">
                {section.items.map((table) => (
                  <button
                    key={table}
                    type="button"
                    className={`sidebar-link ${selectedTable === table ? "sidebar-link-active" : ""}`}
                    onClick={() => setSelectedTable(table)}
                  >
                    <span className="sidebar-link-bullet" />
                    <span>{getTableLabel(table)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </nav>

        {selectedTable === "stock" && (
          <section className="sidebar-section">
            <p className="sidebar-section-title">Nástroje</p>
            <div className="sidebar-tree">
              <button
                type="button"
                className={`sidebar-link ${isCompanySettingsOpen ? "sidebar-link-active" : ""}`}
                onClick={() => setIsCompanySettingsOpen((current) => !current)}
              >
                <span className="sidebar-link-bullet" />
                <span>Nastavenia firmy</span>
              </button>
            </div>
          </section>
        )}
      </aside>

      <div className="dashboard-main">
      <section className="hero dashboard-hero">
        <div className="hero-top">
          <div>
            <p className="panel-meta">{currentCompanyLabel}</p>
            <h1>{tableConfig.title}</h1>
            <p className="subtitle">{tableConfig.subtitle}</p>
          </div>
          <div className="hero-badges">
            <span className="table-badge">{getTableLabel(selectedTable)}</span>
            {canAccessOrdersModule && <span className="table-badge">objednávky + výroba</span>}
            {selectedTable === "stock" && <span className="table-badge">sklad</span>}
          </div>
        </div>

        <div className="actions-row">
          <div className="action-buttons">
            {selectedTable === "stock" && (
              <>
                {!isMaster && (
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() => setIsMaterialSubscriptionOpen((current) => !current)}
                  >
                    {isMaterialSubscriptionOpen ? "Skryť sledovanie" : "Sledovanie materiálu"}
                  </button>
                )}
              </>
            )}
            {!isWorkflowModule(selectedTable) && (
              <button type="button" onClick={exportToExcel} className="export-btn">
                Export do Excelu
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isOrdersModule(selectedTable)) {
                  loadOrdersModuleData();
                  return;
                }
                if (isProductionModule(selectedTable)) {
                  loadProductionModuleData();
                  return;
                }
                loadRows(selectedTable);
              }}
              className="refresh-btn"
            >
              Obnoviť
            </button>
            <button type="button" onClick={handleSignOut} className="logout-btn" disabled={signOutSubmitting}>
              Odhlásiť sa
            </button>
          </div>
        </div>
      </section>

      {selectedTable === "stock" && isCompanySettingsOpen && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Nastavenia firmy</h2>
              <p className="panel-meta">
                {activeCompany
                  ? `Kapacita skladu pre firmu ${activeCompany.name}`
                  : "Vyber konkrétnu firmu, aby sa dala upraviť kapacita skladu."}
              </p>
            </div>
          </div>

          <form className="company-settings-form" onSubmit={handleSaveCompanyMaxPositions}>
            <label className="settings-field" htmlFor="company-max-positions">
              <span>Počet miest na sklade</span>
              <input
                id="company-max-positions"
                type="number"
                min={1}
                max={1000000}
                className="dead-stock-days-input"
                value={companyMaxPositionsInput}
                onChange={(event) => setCompanyMaxPositionsInput(event.target.value)}
                disabled={!activeCompanyId || companySettingsSubmitting}
              />
            </label>
            <label className="settings-field">
              <span>Food & beverage / expirácia</span>
              <label className="pricing-options">
                <input
                  type="checkbox"
                  checked={companyTracksExpiryDateInput}
                  onChange={(event) => setCompanyTracksExpiryDateInput(event.target.checked)}
                  disabled={!activeCompanyId || companySettingsSubmitting}
                />
                <span>Sledovať dátum spotreby pre túto firmu</span>
              </label>
            </label>
            <button type="submit" className="settings-btn" disabled={!activeCompanyId || companySettingsSubmitting}>
              {companySettingsSubmitting ? "Ukladám..." : "Uložiť kapacitu"}
            </button>
          </form>
          {companySettingsError && <p className="error">{companySettingsError}</p>}
          <p className="settings-hint">
            Táto hodnota sa ukladá pre firmu a používa sa pri výpočte obsadenosti a voľných miest.
          </p>
        </section>
      )}

      {selectedTable === "stock" && !isMaster && isMaterialSubscriptionOpen && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Sledovanie materiálu</h2>
              <p className="panel-meta">Email alerty pre vybrané materiály.</p>
            </div>
          </div>
          <form className="material-subscription-form" onSubmit={handleMaterialSubscriptionSave}>
            <input
              type="text"
              className="search-input"
              placeholder="Materiál, napr. TEST-MAT-001"
              list="material-subscription-options"
              value={subscriptionMaterialInput}
              onChange={(event) => setSubscriptionMaterialInput(event.target.value)}
              disabled={Boolean(materialSubscriptionSavingKey)}
            />
            <datalist id="material-subscription-options">
              {availableMaterialSuggestions.map((materialCode) => (
                <option key={materialCode} value={materialCode} />
              ))}
            </datalist>
            <input
              type="email"
              className="search-input"
              placeholder="Cieľový email"
              value={subscriptionEmailInput}
              onChange={(event) => setSubscriptionEmailInput(event.target.value)}
              disabled={Boolean(materialSubscriptionSavingKey)}
            />
            <button type="submit" className="settings-btn" disabled={Boolean(materialSubscriptionSavingKey)}>
              {materialSubscriptionSavingKey ? "Ukladám..." : "Pridať odber"}
            </button>
          </form>
          {materialSubscriptions.length > 0 ? (
            <div className="subscription-list-panel">
              {materialSubscriptions.map((item) => (
                <div key={item.id} className="subscription-card">
                  <div>
                    <strong>{item.material_code}</strong>
                    <div className="subscription-hint">{item.email}</div>
                  </div>
                  <button
                    type="button"
                    className="clear-btn"
                    onClick={() => handleMaterialSubscriptionDisable(item)}
                    disabled={materialSubscriptionSavingKey === makeMaterialSubscriptionKey(item.company_id, item.material_code)}
                  >
                    Vypnúť
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-hint">Zatiaľ nemáš nastavený žiadny odber materiálu.</p>
          )}
        </section>
      )}

      {selectedTable === PRICE_LIST_TABLE && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Editor cenníka</h2>
              <p className="panel-meta">
                {activeCompanyId
                  ? `Ceny materiálov pre firmu ${currentCompanyLabel}`
                  : "Vyber konkrétnu firmu, aby sa dal upravovať cenník."}
              </p>
            </div>
          </div>

          <form className="price-list-form" onSubmit={handleSavePriceListItem}>
            <div className="price-list-form-grid">
              <label className="settings-field price-list-material-field">
                <span>Materiál</span>
                <input
                  type="text"
                  className="search-input"
                  list="price-list-material-options"
                  placeholder="Materiál, napr. MAT-001"
                  value={priceListMaterialInput}
                  onChange={(event) => handlePriceListMaterialChange(event.target.value)}
                  disabled={!activeCompanyId || priceListSubmitting || priceListDeleting}
                />
              </label>
              <label className="settings-field price-list-unit-field">
                <span>Jednotka</span>
                <input
                  type="text"
                  className="search-input"
                  placeholder="ks"
                  value={priceListUnitInput}
                  onChange={(event) => setPriceListUnitInput(event.target.value)}
                  disabled={!activeCompanyId || priceListSubmitting || priceListDeleting}
                />
              </label>
              <label className="settings-field price-list-value-field">
                <span>Cena bez DPH</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="search-input"
                  placeholder="12,50"
                  value={priceListValueInput}
                  onChange={(event) => setPriceListValueInput(event.target.value)}
                  disabled={!activeCompanyId || priceListSubmitting || priceListDeleting}
                />
              </label>
              <label className="settings-field price-list-value-field">
                <span>Nákupná cena</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="search-input"
                  placeholder="9,40"
                  value={priceListPurchaseInput}
                  onChange={(event) => setPriceListPurchaseInput(event.target.value)}
                  disabled={!activeCompanyId || priceListSubmitting || priceListDeleting}
                />
              </label>
            </div>

            <datalist id="price-list-material-options">
              {priceListMaterialSuggestions.map((materialCode) => (
                <option key={materialCode} value={materialCode} />
              ))}
            </datalist>

            <label className="settings-field">
              <span>Poznámka</span>
              <input
                type="text"
                className="search-input"
                placeholder="Voliteľná poznámka k cene"
                value={priceListNoteInput}
                onChange={(event) => setPriceListNoteInput(event.target.value)}
                disabled={!activeCompanyId || priceListSubmitting || priceListDeleting}
              />
            </label>

            <div className="price-list-preview-grid">
              <article className={`card price-list-preview-card ${priceListPreview.marginValue < 0 ? "card-alert" : ""}`}>
                <p>Marža</p>
                <strong>{formatCurrencyValue(priceListPreview.marginValue)}</strong>
                <p className="occupancy-meta">
                  {priceListPreview.hasValidSalePrice ? formatPercentValue(priceListPreview.salePrice > 0 ? (priceListPreview.marginValue / priceListPreview.salePrice) * 100 : 0) : "-"}
                </p>
              </article>
              <article className="card price-list-preview-card">
                <p>Max zľava</p>
                <strong>{formatCurrencyValue(priceListPreview.maxDiscountValue)}</strong>
                <p className="occupancy-meta">{formatPercentValue(priceListPreview.maxDiscountPercent)}</p>
              </article>
              <article className="card price-list-preview-card">
                <p>Min. predaj</p>
                <strong>{formatCurrencyValue(priceListPreview.purchasePrice)}</strong>
                <p className="occupancy-meta">pod túto cenu ideš do mínusu</p>
              </article>
            </div>

            <div className="price-list-form-actions">
              <button type="submit" className="settings-btn" disabled={!activeCompanyId || priceListSubmitting || priceListDeleting}>
                {priceListSubmitting ? "Ukladám..." : selectedPriceListRow ? "Uložiť zmenu" : "Pridať do cenníka"}
              </button>
              <label className={`clear-btn price-list-import-btn ${!activeCompanyId || priceListImportSubmitting ? "price-list-import-btn-disabled" : ""}`}>
                {priceListImportSubmitting ? "Importujem..." : "Import CSV/XLS/XLSX"}
                <input
                  ref={priceListImportInputRef}
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  className="price-list-import-input"
                  onChange={handlePriceListImport}
                  disabled={!activeCompanyId || priceListImportSubmitting || priceListSubmitting || priceListDeleting}
                />
              </label>
              <button
                type="button"
                className="clear-btn"
                onClick={resetPriceListForm}
                disabled={priceListSubmitting || priceListDeleting || priceListImportSubmitting}
              >
                Vyčistiť
              </button>
              {selectedPriceListRow && (
                <>
                  <button
                    type="button"
                    className="clear-btn"
                    onClick={() => fillPriceListFormFromRow(selectedPriceListRow)}
                    disabled={priceListSubmitting || priceListDeleting || priceListImportSubmitting}
                  >
                    Obnoviť hodnoty
                  </button>
                  <button
                    type="button"
                    className="clear-btn"
                    onClick={handleDeletePriceListItem}
                    disabled={priceListSubmitting || priceListDeleting || priceListImportSubmitting}
                  >
                    {priceListDeleting ? "Mažem..." : "Zmazať položku"}
                  </button>
                </>
              )}
            </div>
          </form>

          {priceListFormError && <p className="error">{priceListFormError}</p>}
          {priceListImportResult && <p className="settings-hint">{priceListImportResult}</p>}

          {selectedPriceListRow ? (
            <div className="price-list-current-card">
              <strong>{selectedPriceListRow.material_code}</strong>
              <p>{`Predaj: ${formatCell(selectedPriceListRow.unit_price, "currency")} / ${selectedPriceListRow.unit || "ks"}`}</p>
              <p>{`Nákup: ${formatCell(selectedPriceListRow.purchase_price, "currency")} | Marža: ${formatCell(selectedPriceListRow.margin_value, "currency")}`}</p>
              <span>{`Max zľava: ${selectedPriceListRow.max_discount_display}`}</span>
              <span>{`Posledná úprava: ${formatCell(selectedPriceListRow.updated_at || selectedPriceListRow.created_at, "date_time")}`}</span>
            </div>
          ) : (
            <p className="settings-hint">
              Zadaj materiál a cenu. Ak materiál v cenníku už existuje, po presnom názve sa načítajú aktuálne hodnoty.
            </p>
          )}
        </section>
      )}

      {isMaster && (
        <section className="panel master-panel">
          <div className="panel-head">
            <div>
              <h2>Master Dashboard</h2>
              <p className="panel-meta">Správa používateľov pre tento Supabase projekt</p>
            </div>
            <div className="master-head-actions">
              <button type="button" className="refresh-btn" onClick={loadCompanies}>
                Obnoviť firmy
              </button>
              <button type="button" className="refresh-btn" onClick={loadManagedUsers} disabled={managedUsersLoading}>
                {managedUsersLoading ? "Načítavam..." : "Obnoviť používateľov"}
              </button>
              <button
                type="button"
                className="refresh-btn"
                onClick={handleRepairUsersWithoutCompany}
                disabled={repairUsersSubmitting}
              >
                {repairUsersSubmitting ? "Opravujem..." : "Opraviť userov bez firmy"}
              </button>
            </div>
          </div>

          <form className="master-company-form" onSubmit={handleCreateCompany}>
            <input
              type="text"
              className="search-input"
              placeholder="Názov firmy"
              value={newCompanyName}
              onChange={(event) => setNewCompanyName(event.target.value)}
              required
            />
            <label className="pricing-options">
              <input
                type="checkbox"
                checked={newCompanyTracksExpiryDate}
                onChange={(event) => setNewCompanyTracksExpiryDate(event.target.checked)}
              />
              <span>Food & beverage</span>
            </label>
            <button type="submit" className="settings-btn" disabled={createCompanySubmitting}>
              {createCompanySubmitting ? "Vytváram..." : "Vytvoriť firmu"}
            </button>
          </form>

          <form className="master-create-form" onSubmit={handleCreateManagedUser}>
            <input
              type="text"
              className="search-input"
              placeholder="login (napr. skladnik01)"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              required
              autoComplete="off"
            />
            <input
              type="password"
              className="search-input"
              placeholder={`Heslo (min ${MIN_MANAGED_PASSWORD_LENGTH} znakov)`}
              value={newUserPassword}
              onChange={(event) => setNewUserPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
            <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}>
              <option value="user">user</option>
              <option value="master">master</option>
            </select>
            <select
              value={newUserCompanyId}
              onChange={(event) => setNewUserCompanyId(event.target.value)}
              disabled={newUserRole === "master"}
            >
              <option value="">Bez firmy</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
                ))}
            </select>
            <label className="pricing-options">
              <input
                type="checkbox"
                checked={newUserRole === "master" ? true : newUserCanManageOrders}
                onChange={(event) => setNewUserCanManageOrders(event.target.checked)}
                disabled={newUserRole === "master"}
              />
              <span>Objednávky + výroba</span>
            </label>
            <button type="submit" className="settings-btn" disabled={createUserSubmitting}>
              {createUserSubmitting ? "Vytváram..." : "Vytvoriť účet"}
            </button>
          </form>

          <form className="master-qr-form" onSubmit={handleGenerateQrLabels}>
            <input
              type="text"
              className="search-input"
              placeholder="Regál, napr. A"
              value={qrRackPrefix}
              onChange={(event) => setQrRackPrefix(event.target.value.toUpperCase())}
              maxLength={4}
              required
            />
            <input
              type="number"
              min={1}
              className="dead-stock-days-input"
              placeholder="Riadky"
              value={qrRowCount}
              onChange={(event) => setQrRowCount(event.target.value)}
              required
            />
            <input
              type="number"
              min={1}
              className="dead-stock-days-input"
              placeholder="Stĺpce"
              value={qrColumnCount}
              onChange={(event) => setQrColumnCount(event.target.value)}
              required
            />
            <button type="submit" className="settings-btn">
              Generovať QR PDF
            </button>
            <button
              type="button"
              className="refresh-btn"
              onClick={() => {
                const prefix = String(qrRackPrefix || "")
                  .trim()
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "");
                const rows = Number.parseInt(String(qrRowCount || "0"), 10);
                const columns = Number.parseInt(String(qrColumnCount || "0"), 10);

                if (!prefix) {
                  setQrGeneratorError("Zadaj názov regálu, napr. A.");
                  return;
                }

                if (!Number.isFinite(rows) || rows < 1) {
                  setQrGeneratorError("Počet riadkov musí byť aspoň 1.");
                  return;
                }

                if (!Number.isFinite(columns) || columns < 1) {
                  setQrGeneratorError("Počet stĺpcov musí byť aspoň 1.");
                  return;
                }

                setQrGeneratorError("");
                try {
                  downloadQrLabelsHtml(buildRackLocationCodes(prefix, rows, columns), resolvePrintableAssetUrl(logo));
                } catch (downloadError) {
                  setQrGeneratorError(downloadError?.message || "Nepodarilo sa stiahnuť QR štítky.");
                }
              }}
            >
              Stiahnuť HTML
            </button>
          </form>
          <p className="settings-hint">
            Formát kódu: <code>{`${String(qrRackPrefix || "A").trim().toUpperCase() || "A"}1A`}</code>. Štítky sa
            otvoria v tlačovom okne ako 40 mm x 40 mm PDF.
          </p>
          {qrGeneratorError && <p className="error">{qrGeneratorError}</p>}

          <section className="pricing-panel">
            <div className="panel-head">
              <div>
                <h2>Kalkulačka ceny</h2>
                <p className="panel-meta">Interný odhad setupu a mesačnej ceny pre WMS nasadenie.</p>
              </div>
            </div>
            <div className="pricing-grid">
              <label className="settings-field">
                <span>Počet zamestnancov</span>
                <input
                  type="number"
                  min={1}
                  className="dead-stock-days-input"
                  value={pricingEmployeeCount}
                  onChange={(event) => setPricingEmployeeCount(event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Počet používateľov</span>
                <input
                  type="number"
                  min={1}
                  className="dead-stock-days-input"
                  value={pricingUserCount}
                  onChange={(event) => setPricingUserCount(event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Počet skladov</span>
                <input
                  type="number"
                  min={1}
                  className="dead-stock-days-input"
                  value={pricingWarehouseCount}
                  onChange={(event) => setPricingWarehouseCount(event.target.value)}
                />
              </label>
            </div>
            <div className="pricing-options">
              <span>V cene: web, Android appka, email alerty, QR workflow</span>
              <label><input type="checkbox" checked={pricingNeedsCustomSupport} onChange={(event) => setPricingNeedsCustomSupport(event.target.checked)} /> Prioritný support / custom</label>
            </div>
            <div className="pricing-result">
              <article className="card">
                <p>Segment</p>
                <strong>{pricingEstimate.summary}</strong>
              </article>
              <article className="card">
                <p>Setup</p>
                <strong>{new Intl.NumberFormat("sk-SK").format(pricingEstimate.setup)} EUR</strong>
              </article>
              <article className="card">
                <p>Mesačne</p>
                <strong>{`od ${new Intl.NumberFormat("sk-SK").format(pricingEstimate.monthly)} EUR`}</strong>
              </article>
              <article className="card">
                <p>Ročne vopred</p>
                <strong>{new Intl.NumberFormat("sk-SK").format(pricingEstimate.annualDiscounted)} EUR</strong>
                <p className="occupancy-meta">{`-20 % | efektívne ${new Intl.NumberFormat("sk-SK").format(pricingEstimate.annualMonthlyEquivalent)} EUR / mes.`}</p>
              </article>
            </div>
          </section>

          {managedUsersError && <p className="error">{managedUsersError}</p>}
          {companiesError && <p className="error">{companiesError}</p>}

          <div className="table-wrap">
            <table className="master-users-table">
              <thead>
                <tr>
                  <th>Firma</th>
                  <th>Expirácia</th>
                  <th>ID</th>
                  <th>Vytvorená</th>
                  <th>Akcie</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => {
                  const isEditing = editingCompanyId === company.id;
                  return (
                    <tr key={company.id}>
                      <td>
                        {isEditing ? (
                          <input
                            type="text"
                            className="search-input"
                            value={editingCompanyName}
                            onChange={(event) => setEditingCompanyName(event.target.value)}
                          />
                        ) : (
                          company.name
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <label className="pricing-options">
                            <input
                              type="checkbox"
                              checked={editingCompanyTracksExpiryDate}
                              onChange={(event) => setEditingCompanyTracksExpiryDate(event.target.checked)}
                            />
                            <span>Food & beverage</span>
                          </label>
                        ) : company.tracks_expiry_date ? (
                          <span className="table-badge table-badge-master">áno</span>
                        ) : (
                          <span className="master-user-email">nie</span>
                        )}
                      </td>
                      <td className="master-user-email">{company.id}</td>
                      <td>{formatDate(company.created_at)}</td>
                      <td>
                        <div className="master-role-actions">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="clear-btn"
                                onClick={() => handleSaveCompany(company.id)}
                                disabled={updateCompanySubmitting}
                              >
                                Uložiť
                              </button>
                              <button type="button" className="clear-btn" onClick={handleCancelEditCompany}>
                                Zrušiť
                              </button>
                            </>
                          ) : (
                            <button type="button" className="clear-btn" onClick={() => handleStartEditCompany(company)}>
                              Upraviť
                            </button>
                          )}
                          <button
                            type="button"
                            className="clear-btn"
                            onClick={() => handleDeleteCompany(company)}
                            disabled={deleteCompanySubmitting}
                          >
                            Zmazať
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="panel-controls">
            <input
              type="search"
              className="search-input"
              placeholder="Hľadaj účet (login, email, id...)"
              value={masterUserSearch}
              onChange={(event) => setMasterUserSearch(event.target.value)}
            />
            <select value={masterUserCompanyFilter} onChange={(event) => setMasterUserCompanyFilter(event.target.value)}>
              <option value="all">Všetky účty</option>
              <option value="__masters__">Len master</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {`Firma: ${company.name}`}
                </option>
              ))}
            </select>
            <span className="panel-meta">{`Nájdené účty: ${filteredManagedUsers.length} / ${managedUsers.length}`}</span>
          </div>

          <div className="table-wrap">
            <table className="master-users-table">
              <thead>
                <tr>
                  <th>Login</th>
                  <th>Rola</th>
                  <th>Firma</th>
                  <th>Objednávky + výroba</th>
                  <th>Supabase</th>
                  <th>Vytvorené</th>
                  <th>Akcie</th>
                </tr>
              </thead>
              <tbody>
                {filteredManagedUsers.map((row) => (
                  <tr key={row.user_id}>
                    <td>
                      {row.username || usernameFromInternalEmail(row.email)}
                      {row.user_id === authUser?.id && <span className="table-badge table-badge-master">ty</span>}
                      <div className="master-user-email">{row.email}</div>
                    </td>
                    <td>{row.role}</td>
                    <td>
                      {row.role === "master" ? (
                        <span className="table-badge table-badge-master">všetky</span>
                      ) : (
                        <select
                          value={row.company_id || ""}
                          onChange={(event) => handleManagedCompanyChange(row, event.target.value)}
                        >
                          <option value="">Bez firmy</option>
                          {companies.map((company) => (
                            <option key={company.id} value={company.id}>
                              {company.name}
                            </option>
                          ))}
                        </select>
                        )}
                    </td>
                    <td>
                      {row.role === "master" ? (
                        <span className="table-badge table-badge-master">áno</span>
                      ) : (
                        <label className="pricing-options">
                          <input
                            type="checkbox"
                            checked={Boolean(row.can_manage_orders)}
                            onChange={(event) => handleManagedOrderAccessChange(row, event.target.checked)}
                          />
                          <span>{row.can_manage_orders ? "povolené" : "zakázané"}</span>
                        </label>
                      )}
                    </td>
                    <td>
                      <div className="master-user-email">{row.db_url || "-"}</div>
                      <div className="master-user-email">{`anon: ${maskSecret(row.db_anon_key)}`}</div>
                    </td>
                    <td>{formatDate(row.created_at)}</td>
                    <td>
                      <div className="master-role-actions">
                        <button
                          type="button"
                          className={`clear-btn ${row.role === "user" ? "stock-view-btn-active" : ""}`}
                          onClick={() => handleManagedRoleChange(row, "user")}
                          disabled={row.role === "user" || row.user_id === authUser?.id}
                        >
                          user
                        </button>
                        <button
                          type="button"
                          className={`clear-btn ${row.role === "master" ? "stock-view-btn-active" : ""}`}
                          onClick={() => handleManagedRoleChange(row, "master")}
                          disabled={row.role === "master"}
                        >
                          master
                        </button>
                        <button
                          type="button"
                          className="clear-btn"
                          onClick={() => handleDeleteManagedUser(row)}
                          disabled={deleteUserSubmitting || row.user_id === authUser?.id}
                        >
                          Zmazať účet
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredManagedUsers.length === 0 && (
                  <tr>
                    <td colSpan={7}>Žiadne účty pre tento filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isOrdersModule(selectedTable) && canAccessOrdersModule && (
        <section className="panel workflow-shell workflow-shell-orders">
          <div className="panel-head workflow-header">
            <div>
              <p className="workflow-eyebrow">Externý workflow</p>
              <h2>Objednávkový modul</h2>
              <p className="panel-meta">
                {activeCompanyId
                  ? `Objednávky pre firmu ${currentCompanyLabel}`
                  : "Vyber konkrétnu firmu, aby sa dali vytvárať zákazníci a objednávky."}
              </p>
            </div>
          </div>

          {ordersError && <p className="error">{ordersError}</p>}

          <div className="orders-summary-grid workflow-summary-grid">
            <article className="card workflow-stat-card">
              <p>Zákazníci</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(customers.length)}</strong>
            </article>
            <article className="card workflow-stat-card">
              <p>Objednávky</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(orders.length)}</strong>
            </article>
            <article className="card workflow-stat-card">
              <p>Položky</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(orderItems.length)}</strong>
            </article>
            <article className="card workflow-stat-card">
              <p>Skladové pozície</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(ordersStockRows.length)}</strong>
            </article>
          </div>

          <div className="orders-layout workflow-grid">
            <div className="orders-column workflow-editor-column">
              <article className="orders-panel-card workflow-card workflow-card-soft">
                <div className="panel-head workflow-section-head">
                  <div>
                    <p className="workflow-section-kicker">Krok 1</p>
                    <h2>Zákazníci</h2>
                    <p className="panel-meta">Najprv založ zákazníka, potom vytvor objednávku.</p>
                  </div>
                </div>
                <form className="orders-form" onSubmit={handleCreateCustomer}>
                  <div className="workflow-form-section">
                    <div className="company-lookup-field">
                      <label className="workflow-field">
                        <span className="workflow-field-label">Názov zákazníka alebo firmy</span>
                        <input
                          type="text"
                          className="search-input"
                          placeholder="Začni písať názov firmy"
                          value={customerNameInput}
                          onChange={(event) => handleCustomerNameInputChange(event.target.value)}
                          disabled={!activeCompanyId || customerSubmitting}
                          required
                        />
                      </label>
                      <p className="workflow-helper-text">
                        Po 3 znakoch sa zobrazia free výsledky z Registra účtovných závierok.
                      </p>
                    {companyLookupLoading && <p className="orders-draft-meta">Vyhľadávam firmu...</p>}
                    {companyLookupError && <p className="error">{companyLookupError}</p>}
                    {companyLookupResults.length > 0 && (
                      <div className="company-lookup-results">
                        {companyLookupResults.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="company-lookup-option"
                            onClick={() => handleSelectRegistryCompany(item)}
                            disabled={customerSubmitting}
                          >
                            <strong>{item.name}</strong>
                            <span>
                              {[item.ico ? `IČO: ${item.ico}` : "", item.dic ? `DIČ: ${item.dic}` : ""].filter(Boolean).join(" | ")}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="company-lookup-meta-grid">
                    <label className="company-lookup-input-field">
                      <span>IČO</span>
                      <input
                        type="text"
                        className="search-input"
                        placeholder="Napr. 31322832"
                        value={customerIcoInput}
                        onChange={(event) => setCustomerIcoInput(event.target.value)}
                        disabled={!activeCompanyId || customerSubmitting}
                      />
                    </label>
                    <label className="company-lookup-input-field">
                      <span>DIČ</span>
                      <input
                        type="text"
                        className="search-input"
                        placeholder="Napr. 2020372640"
                        value={customerDicInput}
                        onChange={(event) => setCustomerDicInput(event.target.value)}
                        disabled={!activeCompanyId || customerSubmitting}
                      />
                    </label>
                  </div>
                  </div>
                  <div className="workflow-field-grid workflow-field-grid-tight workflow-field-grid-contact">
                    <label className="workflow-field">
                      <span className="workflow-field-label">Email</span>
                      <input
                        type="email"
                        className="search-input"
                        placeholder="kontakt@firma.sk"
                        value={customerEmailInput}
                        onChange={(event) => setCustomerEmailInput(event.target.value)}
                        disabled={!activeCompanyId || customerSubmitting}
                      />
                    </label>
                    <label className="workflow-field workflow-field-compact workflow-phone-field">
                      <span className="workflow-field-label">Telefón</span>
                      <input
                        type="text"
                        className="search-input workflow-phone-input"
                        placeholder="+421..."
                        value={customerPhoneInput}
                        onChange={(event) => setCustomerPhoneInput(event.target.value)}
                        disabled={!activeCompanyId || customerSubmitting}
                      />
                    </label>
                  </div>
                  <label className="workflow-field">
                    <span className="workflow-field-label">Adresa</span>
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Ulica, mesto"
                      value={customerAddressInput}
                      onChange={(event) => setCustomerAddressInput(event.target.value)}
                      disabled={!activeCompanyId || customerSubmitting}
                    />
                  </label>
                  <label className="workflow-field">
                    <span className="workflow-field-label">Poznámka</span>
                    <textarea
                      className="order-note-input"
                      placeholder="Interná poznámka k zákazníkovi"
                      value={customerNoteInput}
                      onChange={(event) => setCustomerNoteInput(event.target.value)}
                      disabled={!activeCompanyId || customerSubmitting}
                    />
                  </label>
                  <button type="submit" className="settings-btn" disabled={!activeCompanyId || customerSubmitting}>
                    {customerSubmitting ? "Ukladám..." : "Pridať zákazníka"}
                  </button>
                </form>
              </article>

              <article className="orders-panel-card workflow-card workflow-card-strong">
                <div className="panel-head workflow-section-head">
                  <div>
                    <p className="workflow-section-kicker">Krok 2</p>
                    <h2>Nová objednávka</h2>
                    <p className="panel-meta">Položky zadávaš voľne, sklad len ponúkne doplnenie a maximum.</p>
                  </div>
                </div>
                <form className="orders-form" onSubmit={handleCreateOrder}>
                  <label className="workflow-field">
                    <span className="workflow-field-label">Zákazník</span>
                    <select
                      value={selectedOrderCustomerId}
                      onChange={(event) => setSelectedOrderCustomerId(event.target.value)}
                      disabled={!activeCompanyId || orderSubmitting}
                    >
                      <option value="">Vyber zákazníka</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="orders-draft-list">
                    <datalist id={ORDER_STOCK_DATALIST_ID}>
                      {ordersStockOptions.map((option) => (
                        <option key={option.stockKey} value={option.label} />
                      ))}
                    </datalist>
                    {orderDraftItems.map((item, index) => (
                      <div key={item.draftId || `draft-${index}`} className="orders-draft-row">
                        {(() => {
                          const selectedStockRow = ordersStockMap[item.stockKey];
                          const stockQuantity = Number(selectedStockRow?.quantity || 0);
                          const quantityMax = stockQuantity > 0 ? Math.floor(stockQuantity) : undefined;
                          const showNote = Boolean(item.showNote || String(item.lineNote || "").trim());

                          return (
                            <>
                              <div className="orders-draft-main">
                                <div className="orders-draft-cell">
                                  <span className="draft-field-label">{`Položka ${index + 1}`}</span>
                                  <input
                                    type="text"
                                    className="search-input"
                                    list={ORDER_STOCK_DATALIST_ID}
                                    placeholder="Položka objednávky"
                                    value={item.stockInput || ""}
                                    onChange={(event) => handleOrderDraftItemChange(index, "stockInput", event.target.value)}
                                    disabled={!activeCompanyId || orderSubmitting}
                                  />
                                  <p className="workflow-helper-text">
                                    {selectedStockRow
                                      ? `Sklad: ${String(selectedStockRow.material_code || "-")} | ${String(selectedStockRow.position || "-")}`
                                      : "Píš voľne, sklad len ponúkne doplnenie."}
                                  </p>
                                </div>
                                <div className="orders-draft-cell workflow-quantity-cell">
                                  <span className="draft-field-label">Množstvo</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={quantityMax}
                                    className="dead-stock-days-input workflow-quantity-input"
                                    placeholder="Množstvo"
                                    value={item.orderedQuantity}
                                    onChange={(event) => handleOrderDraftItemChange(index, "orderedQuantity", event.target.value)}
                                    disabled={!activeCompanyId || orderSubmitting}
                                  />
                                  <p className="workflow-helper-text">
                                    {selectedStockRow
                                      ? `Max zo skladu: ${new Intl.NumberFormat("sk-SK").format(stockQuantity)} ks`
                                      : "Bez limitu skladu."}
                                  </p>
                                </div>
                              </div>
                              <div className="orders-draft-actions">
                                <button
                                  type="button"
                                  className="clear-btn"
                                  onClick={() => handleOrderDraftItemChange(index, "showNote", !showNote)}
                                  disabled={!activeCompanyId || orderSubmitting}
                                >
                                  {showNote ? "Skryť poznámku" : "Pridať poznámku"}
                                </button>
                                <button type="button" className="clear-btn" onClick={() => handleRemoveOrderDraftItem(index)}>
                                  Odobrať
                                </button>
                              </div>
                              {showNote && (
                                <div className="orders-draft-note-row">
                                  <input
                                    type="text"
                                    className="search-input"
                                    placeholder="Poznámka položky"
                                    value={item.lineNote}
                                    onChange={(event) => handleOrderDraftItemChange(index, "lineNote", event.target.value)}
                                    disabled={!activeCompanyId || orderSubmitting}
                                  />
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>

                  <div className="orders-form-actions">
                    <button type="button" className="clear-btn" onClick={handleAddOrderDraftItem}>
                      Pridať položku
                    </button>
                    <button type="submit" className="settings-btn" disabled={!activeCompanyId || orderSubmitting}>
                      {orderSubmitting ? "Vytváram..." : "Vytvoriť objednávku"}
                    </button>
                  </div>
                  {ordersError && <p className="error">{ordersError}</p>}
                </form>
              </article>
            </div>

            <div className="orders-column orders-column-list workflow-feed-column">
              <article className="orders-panel-card workflow-card workflow-card-list">
                <div className="panel-head workflow-section-head">
                  <div>
                    <h2>Zoznam objednávok</h2>
                    <p className="panel-meta">{`${filteredOrders.length} / ${orders.length} objednávok`}</p>
                  </div>
                </div>
                <div className="panel-controls">
                  <input
                    type="search"
                    className="search-input"
                    placeholder="Hľadaj zákazníka alebo číslo objednávky"
                    value={orderSearchTerm}
                    onChange={(event) => setOrderSearchTerm(event.target.value)}
                  />
                </div>

                {ordersLoading ? (
                  <p className="hint">Načítavam objednávky...</p>
                ) : filteredOrders.length === 0 ? (
                  <p className="hint">Zatiaľ tu nie sú objednávky.</p>
                ) : (
                  <div className="orders-list">
                    {filteredOrders.map((order) => {
                      const isOpen = Boolean(expandedOrders[order.id]);
                      const items = orderItemsByOrderId[order.id] || [];
                      return (
                        <article key={order.id} className="order-card">
                          <button
                            type="button"
                            className="order-card-head"
                            onClick={() => setExpandedOrders((prev) => ({ ...prev, [order.id]: !prev[order.id] }))}
                          >
                            <div>
                              <strong>{order.customer_name}</strong>
                              <p>{order.order_number}</p>
                            </div>
                            <div className="order-card-meta">
                              <span className="order-card-badge">{formatDate(order.created_at)}</span>
                              <span className="order-card-badge">{`${items.length} položiek`}</span>
                            </div>
                          </button>
                          {isOpen && (
                            <div className="order-card-body">
                              {order.note && <p className="order-card-note">{order.note}</p>}
                              <div className="order-card-actions">
                                <button type="button" className="clear-btn" onClick={() => handlePrintOrder(order)}>
                                  PDF
                                </button>
                              </div>
                              <div className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Materiál</th>
                                      <th>Pozícia</th>
                                      <th>Množstvo</th>
                                      <th>Sklad</th>
                                      <th>Poznámka</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((item) => (
                                      <tr key={item.id}>
                                        <td>{item.material_code}</td>
                                        <td>{item.position}</td>
                                        <td>{formatCell(item.ordered_quantity, "number")}</td>
                                        <td>{formatCell(item.stock_quantity_snapshot, "number")}</td>
                                        <td>{item.line_note || "-"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </article>
            </div>
          </div>
        </section>
      )}

      {isProductionModule(selectedTable) && canAccessOrdersModule && (
        <section className="panel workflow-shell workflow-shell-production">
          <div className="panel-head workflow-header">
            <div>
              <p className="workflow-eyebrow">Interný workflow</p>
              <h2>Výrobné objednávky</h2>
              <p className="panel-meta">
                {activeCompanyId
                  ? `Interná výroba pre firmu ${currentCompanyLabel}`
                  : "Vyber konkrétnu firmu, aby sa dali vytvárať výrobné objednávky."}
              </p>
            </div>
          </div>

          {productionError && <p className="error">{productionError}</p>}

          <div className="orders-summary-grid workflow-summary-grid">
            <article className="card workflow-stat-card">
              <p>Výrobné zákazky</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(productionOrders.length)}</strong>
            </article>
            <article className="card workflow-stat-card">
              <p>Vstupy</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(productionOrderInputs.length)}</strong>
            </article>
            <article className="card workflow-stat-card">
              <p>Výstupy</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(productionOrderOutputs.length)}</strong>
            </article>
            <article className="card workflow-stat-card">
              <p>Skladové pozície</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(productionStockRows.length)}</strong>
            </article>
          </div>

          <div className="orders-layout workflow-grid">
            <div className="orders-column workflow-editor-column">
              <article className="orders-panel-card workflow-card workflow-card-strong">
                <div className="panel-head workflow-section-head">
                  <div>
                    <p className="workflow-section-kicker">Nová výroba</p>
                    <h2>Nová výrobná objednávka</h2>
                    <p className="panel-meta">Vstupy sa odpíšu až pri naskladnení výstupu.</p>
                  </div>
                </div>
                <form className="orders-form" onSubmit={handleCreateProductionOrder}>
                  <label className="workflow-field">
                    <span className="workflow-field-label">Názov výroby alebo zákazky</span>
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Napíš, čo sa ide vyrábať"
                      value={productionTitleInput}
                      onChange={(event) => setProductionTitleInput(event.target.value)}
                      disabled={!activeCompanyId || productionSubmitting}
                      required
                    />
                  </label>

                  <div className="workflow-form-section">
                    <div className="panel-head workflow-section-head workflow-subsection-head">
                      <div>
                        <h2>Vstupy zo skladu</h2>
                        <p className="panel-meta">Vyber materiály, ktoré sa majú spotrebovať pri naskladnení výstupu.</p>
                      </div>
                    </div>
                    <div className="orders-draft-list">
                      <datalist id={PRODUCTION_INPUT_DATALIST_ID}>
                        {productionStockOptions.map((option) => (
                          <option key={option.stockKey} value={option.label} />
                        ))}
                      </datalist>
                      {productionDraftInputs.map((item, index) => {
                        const selectedStockRow = productionStockMap[item.stockKey];
                        const stockQuantity = Number(selectedStockRow?.quantity || 0);
                        const quantityMax = stockQuantity > 0 ? Math.floor(stockQuantity) : undefined;
                        const showNote = Boolean(item.showNote || String(item.lineNote || "").trim());

                        return (
                          <div key={item.draftId || `production-input-${index}`} className="orders-draft-row">
                            <div className="orders-draft-main">
                              <div className="orders-draft-cell">
                                <span className="draft-field-label">{`Vstup ${index + 1}`}</span>
                                <input
                                  type="text"
                                  className="search-input"
                                  list={PRODUCTION_INPUT_DATALIST_ID}
                                  placeholder="Vstupný materiál zo skladu"
                                  value={item.stockInput || ""}
                                  onChange={(event) => handleProductionInputChange(index, "stockInput", event.target.value)}
                                  disabled={!activeCompanyId || productionSubmitting}
                                />
                                <p className="workflow-helper-text">
                                  {selectedStockRow
                                    ? `Sklad: ${String(selectedStockRow.material_code || "-")} | ${String(selectedStockRow.position || "-")}`
                                    : "Môžeš písať voľne, sklad len ponúkne doplnenie."}
                                </p>
                              </div>
                              <div className="orders-draft-cell workflow-quantity-cell">
                                <span className="draft-field-label">Množstvo</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={quantityMax}
                                  className="dead-stock-days-input workflow-quantity-input"
                                  placeholder="Množstvo"
                                  value={item.requiredQuantity}
                                  onChange={(event) => handleProductionInputChange(index, "requiredQuantity", event.target.value)}
                                  disabled={!activeCompanyId || productionSubmitting}
                                />
                                  <p className="workflow-helper-text">
                                    {selectedStockRow
                                      ? `Max zo skladu: ${new Intl.NumberFormat("sk-SK").format(stockQuantity)} ks`
                                      : ""}
                                  </p>
                              </div>
                            </div>
                            <div className="orders-draft-actions">
                              <button
                                type="button"
                                className="clear-btn"
                                onClick={() => handleProductionInputChange(index, "showNote", !showNote)}
                                disabled={!activeCompanyId || productionSubmitting}
                              >
                                {showNote ? "Skryť poznámku" : "Pridať poznámku"}
                              </button>
                              <button type="button" className="clear-btn" onClick={() => handleRemoveProductionInput(index)}>
                                Odobrať vstup
                              </button>
                            </div>
                            {showNote && (
                              <div className="orders-draft-note-row">
                                <input
                                  type="text"
                                  className="search-input"
                                  placeholder="Poznámka vstupu"
                                  value={item.lineNote}
                                  onChange={(event) => handleProductionInputChange(index, "lineNote", event.target.value)}
                                  disabled={!activeCompanyId || productionSubmitting}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="orders-form-actions">
                      <button type="button" className="clear-btn" onClick={handleAddProductionInput}>
                        Pridať vstup
                      </button>
                    </div>
                  </div>

                  <div className="workflow-form-section">
                    <div className="panel-head workflow-section-head workflow-subsection-head">
                      <div>
                        <h2>Výstupy výroby</h2>
                        <p className="panel-meta">Zadaj finálne položky, ktoré sa majú naskladniť.</p>
                      </div>
                    </div>
                    <div className="orders-draft-list">
                      <datalist id={PRODUCTION_OUTPUT_MATERIAL_DATALIST_ID}>
                        {productionOutputMaterialOptions.map((materialCode) => (
                          <option key={materialCode} value={materialCode} />
                        ))}
                      </datalist>
                      {productionDraftOutputs.map((item, index) => {
                        const showNote = Boolean(item.showNote || String(item.lineNote || "").trim());
                        return (
                          <div key={item.draftId || `production-output-${index}`} className="orders-draft-row">
                            <div className="orders-draft-main production-output-main">
                              <div className="orders-draft-cell production-output-primary">
                                <span className="draft-field-label">{`Výstup ${index + 1}`}</span>
                                <input
                                  type="text"
                                  className="search-input"
                                  list={PRODUCTION_OUTPUT_MATERIAL_DATALIST_ID}
                                  placeholder="Finálna položka"
                                  value={item.materialCode}
                                  onChange={(event) => handleProductionOutputChange(index, "materialCode", event.target.value)}
                                  disabled={!activeCompanyId || productionSubmitting}
                                />
                                <p className="workflow-helper-text">Materiál alebo kód finálneho výrobku.</p>
                              </div>
                              <div className="orders-draft-cell production-output-compact workflow-quantity-cell">
                                <span className="draft-field-label">Množstvo</span>
                                <input
                                  type="number"
                                  min={1}
                                  className="dead-stock-days-input workflow-quantity-input"
                                  placeholder="Množstvo"
                                  value={item.outputQuantity}
                                  onChange={(event) => handleProductionOutputChange(index, "outputQuantity", event.target.value)}
                                  disabled={!activeCompanyId || productionSubmitting}
                                />
                                <p className="workflow-helper-text">Naskladní sa pri dokončení výroby.</p>
                              </div>
                            </div>
                            <div className="orders-draft-actions">
                              <button
                                type="button"
                                className="clear-btn"
                                onClick={() => handleProductionOutputChange(index, "showNote", !showNote)}
                                disabled={!activeCompanyId || productionSubmitting}
                              >
                                {showNote ? "Skryť poznámku" : "Pridať poznámku"}
                              </button>
                              <button type="button" className="clear-btn" onClick={() => handleRemoveProductionOutput(index)}>
                                Odobrať výstup
                              </button>
                            </div>
                            {showNote && (
                              <div className="orders-draft-note-row">
                                <input
                                  type="text"
                                  className="search-input"
                                  placeholder="Poznámka výstupu"
                                  value={item.lineNote}
                                  onChange={(event) => handleProductionOutputChange(index, "lineNote", event.target.value)}
                                  disabled={!activeCompanyId || productionSubmitting}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="orders-form-actions">
                      <button type="button" className="clear-btn" onClick={handleAddProductionOutput}>
                        Pridať výstup
                      </button>
                    </div>
                  </div>

                  <div className="orders-form-actions">
                    <button type="submit" className="settings-btn" disabled={!activeCompanyId || productionSubmitting}>
                      {productionSubmitting ? "Vytváram..." : "Vytvoriť výrobnú objednávku"}
                    </button>
                  </div>
                  {productionError && <p className="error">{productionError}</p>}
                </form>
              </article>
            </div>

            <div className="orders-column orders-column-list workflow-feed-column">
              <article className="orders-panel-card workflow-card workflow-card-list">
                <div className="panel-head workflow-section-head">
                  <div>
                    <h2>Zoznam výrobných objednávok</h2>
                    <p className="panel-meta">{`${filteredProductionOrders.length} / ${productionOrders.length} zákaziek`}</p>
                  </div>
                </div>
                <div className="panel-controls">
                  <input
                    type="search"
                    className="search-input"
                    placeholder="Hľadaj číslo, názov alebo stav"
                    value={productionSearchTerm}
                    onChange={(event) => setProductionSearchTerm(event.target.value)}
                  />
                </div>

                {productionLoading ? (
                  <p className="hint">Načítavam výrobné objednávky...</p>
                ) : filteredProductionOrders.length === 0 ? (
                  <p className="hint">Zatiaľ tu nie sú výrobné objednávky.</p>
                ) : (
                  <div className="orders-list">
                    {filteredProductionOrders.map((productionOrder) => {
                      const isOpen = Boolean(expandedProductionOrders[productionOrder.id]);
                      const inputs = productionInputsByOrderId[productionOrder.id] || [];
                      const outputs = productionOutputsByOrderId[productionOrder.id] || [];
                      return (
                        <article key={productionOrder.id} className="order-card">
                          <button
                            type="button"
                            className="order-card-head"
                            onClick={() =>
                              setExpandedProductionOrders((prev) => ({ ...prev, [productionOrder.id]: !prev[productionOrder.id] }))
                            }
                          >
                            <div>
                              <strong>{productionOrder.title}</strong>
                              <p>{productionOrder.production_number}</p>
                            </div>
                            <div className="order-card-meta">
                              <span className="order-card-badge">{formatDate(productionOrder.created_at)}</span>
                              <span className="order-card-badge">{`${inputs.length} vstupov / ${outputs.length} výstupov`}</span>
                            </div>
                            </button>
                          {isOpen && (
                            <div className="order-card-body">
                              <div className="order-card-actions">
                                <button
                                  type="button"
                                  className="clear-btn"
                                  onClick={() => handlePrintProductionOrder(productionOrder)}
                                >
                                  PDF
                                </button>
                                <StatusPill status={String(productionOrder.status || "draft")} />
                                {productionOrder.status !== "completed" && (
                                  <button
                                    type="button"
                                    className="settings-btn"
                                    onClick={() => handleCompleteProductionOrder(productionOrder)}
                                    disabled={productionCompletingId === productionOrder.id}
                                  >
                                     {productionCompletingId === productionOrder.id ? "Naskladňujem..." : "Naskladniť a dokončiť"}
                                  </button>
                                )}
                              </div>
                              <div className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th colSpan={4}>Vstupy zo skladu</th>
                                    </tr>
                                    <tr>
                                      <th>Materiál</th>
                                      <th>Pozícia</th>
                                      <th>Množstvo</th>
                                      <th>Poznámka</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {inputs.map((item) => (
                                      <tr key={item.id}>
                                        <td>{item.material_code}</td>
                                        <td>{item.position}</td>
                                        <td>{formatCell(item.required_quantity, "number")}</td>
                                        <td>{item.line_note || "-"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th colSpan={3}>Výstupy výroby</th>
                                    </tr>
                                    <tr>
                                      <th>Materiál</th>
                                      <th>Množstvo</th>
                                      <th>Poznámka</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {outputs.map((item) => (
                                      <tr key={item.id}>
                                        <td>{item.material_code}</td>
                                        <td>{formatCell(item.output_quantity, "number")}</td>
                                        <td>{item.line_note || "-"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </article>
            </div>
          </div>
        </section>
      )}

      {!isMaster && !isWorkflowModule(selectedTable) && (
      <section className="stats-grid">
        {isDailyOverviewTable(selectedTable) && dailyOverviewStats && (
          <>
            <article className="card">
              <p>Dnešné pohyby</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(rows.length)}</strong>
            </article>
            <article className="card">
              <p>Príjmy dnes</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(dailyOverviewStats.receive)}</strong>
            </article>
            <article className="card">
              <p>Výdaje dnes</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(dailyOverviewStats.issue)}</strong>
            </article>
            <article className="card">
              <p>Presuny dnes</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(dailyOverviewStats.move)}</strong>
            </article>
            <article className="card">
              <p>Aktívne pozície</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(dailyOverviewStats.activePositions)}</strong>
            </article>
            <article className="card">
              <p>Materiály dnes</p>
              <strong>{new Intl.NumberFormat("sk-SK").format(dailyOverviewStats.uniqueMaterials)}</strong>
            </article>
            <article className="card">
              <p>Najsilnejšia hodina</p>
              <strong>{dailyOverviewStats.busiestHourLabel}</strong>
              <p className="occupancy-meta">{`${dailyOverviewStats.busiestHourCount} pohybov`}</p>
            </article>
            <article className="card">
              <p>Posledná operácia</p>
              <strong className="small-text">{lastTimestamp}</strong>
            </article>
          </>
        )}
        {!isDailyOverviewTable(selectedTable) && selectedTable !== "stock" && (
          <article className="card">
            <p>Počet riadkov</p>
            <strong>{rows.length}</strong>
          </article>
        )}
        {!isDailyOverviewTable(selectedTable) && (
          <article className="card">
            <p>{effectiveTableConfig.metricLabel}</p>
            <strong>{new Intl.NumberFormat("sk-SK").format(metricValue)}</strong>
          </article>
        )}
        {isTransactionsTable(selectedTable) && !isDailyOverviewTable(selectedTable) && (
          <article className="card">
            <p>Výdaje</p>
            <strong>{new Intl.NumberFormat("sk-SK").format(issueCount)}</strong>
          </article>
        )}
        {!isDailyOverviewTable(selectedTable) && (
          <article className="card">
            <p>Posledná zmena</p>
            <strong className="small-text">{lastTimestamp}</strong>
          </article>
        )}
        {selectedTable === "stock" && (
          <article className={`card ${deadStockCount > 0 ? "card-alert" : ""}`}>
            <p>Dead stock ({deadStockDays} dní)</p>
            <strong>{new Intl.NumberFormat("sk-SK").format(deadStockCount)}</strong>
          </article>
        )}
        {selectedTable === "stock" && (
          <article className="card">
            <p>Priemerný čas na sklade</p>
            <strong>
              {stockAgeStats.avgDays === null
                ? "-"
                : `${new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 1 }).format(stockAgeStats.avgDays)} dní`}
            </strong>
            <p className="occupancy-meta">{`Vzorka: ${stockAgeStats.sampleCount} položiek`}</p>
          </article>
        )}
        {isDailyOverviewTable(selectedTable) && (
          <article className={`card occupancy-${occupancyLevel}`}>
            <p>Zaplnenie skladu</p>
            <strong className={`occupancy-value occupancy-value-${occupancyLevel}`}>
              {`${new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 1 }).format(occupancyPercent)} %`}
            </strong>
            <p className="occupancy-meta">{`Obsadené: ${occupiedPositions} / ${effectiveMaxPositions}`}</p>
            <p className={`occupancy-badge occupancy-badge-${occupancyLevel}`}>{`Stav: ${occupancyLabel}`}</p>
          </article>
        )}
        {selectedTable === "stock" && (
          <article className="card">
            <p>Voľné miesta</p>
            <strong>{new Intl.NumberFormat("sk-SK").format(freePositions)}</strong>
          </article>
        )}
      </section>
      )}

      {!isMaster && !isWorkflowModule(selectedTable) && isDailyOverviewTable(selectedTable) && dailyOverviewStats && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Dnešná aktivita</h2>
              <p className="panel-meta">Rozloženie pohybov počas dneška a posledné operácie</p>
            </div>
          </div>
          <div className="daily-overview-grid">
            <article className="card">
              <p>Hodinový prehľad</p>
              <div
                className="daily-hour-bars"
                style={{ gridTemplateColumns: `repeat(${Math.max(1, dailyOverviewStats.hourlyBuckets.length)}, minmax(0, 1fr))` }}
              >
                {dailyOverviewStats.hourlyBuckets.map((bucket) => {
                  const maxCount = Math.max(1, ...dailyOverviewStats.hourlyBuckets.map((item) => item.count));
                  const ratio = bucket.count <= 0 ? 0 : bucket.count / maxCount;
                  const scaledRatio = ratio <= 0 ? 0 : Math.pow(ratio, 0.72);
                  const height = bucket.count <= 0 ? "0%" : `${Math.max(10, scaledRatio * 100)}%`;
                  return (
                    <div key={bucket.hour} className="daily-hour-bar-wrap" title={`${String(bucket.hour).padStart(2, "0")}:00 - ${bucket.count} pohybov`}>
                      <div className="daily-hour-bar-track">
                        <div className="daily-hour-bar" style={{ height }} />
                      </div>
                      <strong className="daily-hour-count">{bucket.count}</strong>
                      <span>{String(bucket.hour).padStart(2, "0")}</span>
                    </div>
                  );
                })}
              </div>
            </article>
            <article className="card">
              <p>Posledné operácie</p>
              {dailyOverviewStats.recentRows.length === 0 ? (
                <p className="hint">Dnes zatiaľ nie sú operácie.</p>
              ) : (
                <div className="daily-activity-list">
                  {dailyOverviewStats.recentRows.map((row, index) => (
                    <div key={row.event_key || `${row.position}-${row.material_code}-${index}`} className="daily-activity-item">
                      <div>
                        <strong>{String(row.material_code || "-")}</strong>
                        <p>{`${String(row.action || "-")} | ${String(row.position || "-")}`}</p>
                      </div>
                      <span>{formatCell(row.created_at_ms, "epoch_ms")}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </section>
      )}

      {isDailyOverviewTable(selectedTable) && !isMaster && !isWorkflowModule(selectedTable) && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Graf zaplnenia skladu</h2>
              <p className="panel-meta">Prehľad podľa transakcií (deň / týždeň / mesiac)</p>
            </div>
            <div className="stock-view-switch">
              {Object.entries(OCCUPANCY_RANGE_CONFIG).map(([rangeKey, rangeCfg]) => (
                <button
                  key={rangeKey}
                  type="button"
                  className={`clear-btn ${occupancyChartRange === rangeKey ? "stock-view-btn-active" : ""}`}
                  onClick={() => setOccupancyChartRange(rangeKey)}
                >
                  {rangeCfg.label}
                </button>
              ))}
            </div>
          </div>
          {occupancySeries.length === 0 ? (
            <p className="hint">Zatiaľ nie sú dáta pre graf.</p>
          ) : (
            <div className="occupancy-chart-wrap">
              <svg viewBox="0 0 100 100" className="occupancy-chart" preserveAspectRatio="none" role="img" aria-label="Graf zaplnenia skladu">
                <line x1="0" y1="100" x2="100" y2="100" className="occupancy-chart-axis" />
                <line
                  x1="0"
                  y1={100 - (100 / occupancyChartMaxPercent) * 100}
                  x2="100"
                  y2={100 - (100 / occupancyChartMaxPercent) * 100}
                  className="occupancy-chart-baseline"
                />
                <polyline points={occupancyChartPolyline} className="occupancy-chart-line" />
              </svg>
              <div className="occupancy-chart-labels">
                <span>{occupancySeries[0]?.label || "-"}</span>
                <span>{occupancySeries[Math.floor((occupancySeries.length - 1) / 2)]?.label || "-"}</span>
                <span>{occupancySeries[occupancySeries.length - 1]?.label || "-"}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {!isMaster && !isWorkflowModule(selectedTable) && (
      <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{isDailyOverviewTable(selectedTable) ? "Dnešné operácie" : "Dátový tok"}</h2>
              <p className="panel-meta">
                {isDailyOverviewTable(selectedTable)
                  ? `Dnes zaznamenaných ${filteredRows.length} / ${rows.length} operácií`
                  : `Zobrazených ${filteredRows.length} / ${rows.length} riadkov`}
              </p>
            {selectedTable === "stock" && deadStockCount > 0 && (
              <p className="dead-stock-meta">
                Alert: {deadStockCount} položiek bez pohybu aspoň {deadStockDays} dní.
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
        {materialSubscriptionsError && selectedTable === "stock" && !isMaster && <p className="error">{materialSubscriptionsError}</p>}

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
                                {showsExpiryDate && <th>Dátum spotreby</th>}
                                <th>Množstvo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row, rowIndex) => {
                                const stockKey = makeStockKey(row.position, row.material_code, row.company_id);
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
                                    {showsExpiryDate && <td>{formatCell(row.expiry_date, "date")}</td>}
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
                      {effectiveTableConfig.columns.map((column) => (
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
                              selectedTable === "stock" && deadStockByKey[makeStockKey(row.position, row.material_code, row.company_id)]
                                ? "dead-stock-row"
                                : "",
                              isSharedPosition ? "shared-position-row" : "",
                              isStrongSharedPosition ? "shared-position-row-strong" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")
                          }
                        >
                          {effectiveTableConfig.columns.map((column) => {
                            const value = pickValue(row, column.keys);
                            const stockKey = makeStockKey(row.position, row.material_code, row.company_id);
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
      )}

      </div>
    </main>
  );
}

export default App;
