export function createTableConfig({
  ATTENDANCE_GROUPS_MODULE,
  ATTENDANCE_MODULE,
  ATTENDANCE_SETTINGS_MODULE,
  CRM_MODULE,
  CUSTOMERS_MODULE,
  DAILY_OVERVIEW_TABLE,
  INVOICES_MODULE,
  ORDERS_MODULE,
  PRICE_LIST_TABLE,
  PRODUCTION_MODULE,
  SYSTEM_ADMIN_MODULE,
  QUOTES_MODULE
}) {
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
    [CRM_MODULE]: {
      title: "CRM",
      subtitle: "Leady, firmy, kontakty a follow-up pipeline",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "CRM firmy",
      metricValue: (rows) => rows.length
    },
    [CUSTOMERS_MODULE]: {
      title: "Zákazníci",
      subtitle: "Databáza zákazníkov pre objednávky a cenové ponuky",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "Zákazníci",
      metricValue: (rows) => rows.length
    },
    [QUOTES_MODULE]: {
      title: "Cenové ponuky",
      subtitle: "Cenové ponuky zo zákazníkov a cenníka",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "Ponuky",
      metricValue: (rows) => rows.length
    },
    [INVOICES_MODULE]: {
      title: "Fakturácia",
      subtitle: "Faktúry zo zákazníkov a cenníka",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "Faktúry",
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
    [ATTENDANCE_MODULE]: {
      title: "Dochádzka",
      subtitle: "Operatívny prehľad príchodov, odchodov a stavov",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "Eventy",
      metricValue: (rows) => rows.length
    },
    [ATTENDANCE_GROUPS_MODULE]: {
      title: "Skupiny",
      subtitle: "Dochádzkové skupiny, zmenovosť a pracovná doba",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "Skupiny",
      metricValue: (rows) => rows.length
    },
    [ATTENDANCE_SETTINGS_MODULE]: {
      title: "Nastavenia dochádzky",
      subtitle: "Terminály, credentials a prepojenie HR modulov",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "Eventy",
      metricValue: (rows) => rows.length
    },
    [PRODUCTION_MODULE]: {
      title: "Prehľad výroby",
      subtitle: "Plánovanie výroby, výrobné zákazky, výkon a rozpracovanosť",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "Výrobné zákazky",
      metricValue: (rows) => rows.length
    },
    [SYSTEM_ADMIN_MODULE]: {
      title: "Správa systému",
      subtitle: "Firmy, účty, billing a systémové prístupy na jednom mieste",
      columns: [],
      searchKeys: [],
      statusKeys: [],
      timeKeys: [],
      orderBy: "created_at",
      orderAsc: false,
      metricLabel: "Tenanty",
      metricValue: (rows) => rows.length
    }
  };
  
  const DEFAULT_CONFIG = {
    title: "Dátová tabuľka",
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

  return { TABLE_CONFIG, DEFAULT_CONFIG };
}
