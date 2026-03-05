import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import StatusPill from "./components/StatusPill";
import { noStoreFetch, supabase, supabaseAnonKey, supabaseUrl, tableNames } from "./supabaseClient";
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

const ROLE_TABLE = (import.meta.env.VITE_USER_ROLES_TABLE || "app_users").trim();
const MASTER_EMAIL = (import.meta.env.VITE_MASTER_EMAIL || "").trim().toLowerCase();
const INTERNAL_LOGIN_DOMAIN = (import.meta.env.VITE_INTERNAL_LOGIN_DOMAIN || "wms.local").trim().toLowerCase();
const APP_BUILD_ID = typeof __APP_BUILD_ID__ === "undefined" ? "dev" : String(__APP_BUILD_ID__);
const DEFAULT_DB_URL = String(supabaseUrl || "").trim();
const DEFAULT_DB_ANON_KEY = String(supabaseAnonKey || "").trim();
const CACHE_BUILD_KEY = "wms_app_build_id";
const CACHE_RELOAD_GUARD_KEY = "wms_app_build_reload_guard";
const MIN_MANAGED_PASSWORD_LENGTH = 8;
const ENV_DEFAULT_DEAD_STOCK_DAYS = Math.max(1, Number(import.meta.env.VITE_DEAD_STOCK_DAYS || 30));
const ENV_DEFAULT_MAX_POSITIONS = Math.max(1, Number(import.meta.env.VITE_MAX_POSITIONS || 100));
const HISTORY_ANALYTICS_LOOKBACK_DAYS = Math.max(30, Number(import.meta.env.VITE_HISTORY_LOOKBACK_DAYS || 365));
const AUTO_REFRESH_MS = Math.max(60 * 1000, Number(import.meta.env.VITE_AUTO_REFRESH_MS || 5 * 60 * 1000));
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTH_INIT_TIMEOUT_MS = 5000;
const INBOUND_ACTIONS = new Set(["RECEIVE", "MOVE", "MOVE_ALL", "ADJUST"]);
const LANDING_FEATURES = [
  "Online prehľad zásob a pohybov v reálnom čase",
  "Rýchly export dát do Excelu pre operatívu",
  "Filter podľa akcie, pozície a materiálu",
  "Napojenie na Traktile lokátory pre sledovanie presunov"
];

function getTableConfig(table) {
  return TABLE_CONFIG[table] || DEFAULT_CONFIG;
}

function makeStockKey(position, materialCode, companyId) {
  return `${String(companyId || "").trim()}::${String(position || "").trim()}::${String(materialCode || "").trim()}`;
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

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
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

function App() {
  const [selectedTable, setSelectedTable] = useState(tableNames[0]);
  const [rows, setRows] = useState([]);
  const [stockViewMode, setStockViewMode] = useState("table");
  const [expandedPositions, setExpandedPositions] = useState({});
  const [deadStockByKey, setDeadStockByKey] = useState({});
  const [stockAgeStats, setStockAgeStats] = useState({ avgDays: null, sampleCount: 0 });
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
  const [authReady, setAuthReady] = useState(false);
  const [authInitTimedOut, setAuthInitTimedOut] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authUsername, setAuthUsername] = useState("");
  const [userRole, setUserRole] = useState("user");
  const [userCompanyId, setUserCompanyId] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [companiesError, setCompaniesError] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("all");
  const [authUsernameInput, setAuthUsernameInput] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [signOutSubmitting, setSignOutSubmitting] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [lastDataLoadAt, setLastDataLoadAt] = useState(null);
  const [lastLoadError, setLastLoadError] = useState("");
  const [lastAuthEvent, setLastAuthEvent] = useState("init");
  const [lastAuthEventAt, setLastAuthEventAt] = useState(null);
  const [managedUsers, setManagedUsers] = useState([]);
  const [managedUsersLoading, setManagedUsersLoading] = useState(false);
  const [managedUsersError, setManagedUsersError] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("user");
  const [newUserCompanyId, setNewUserCompanyId] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [editingCompanyId, setEditingCompanyId] = useState("");
  const [editingCompanyName, setEditingCompanyName] = useState("");
  const [createCompanySubmitting, setCreateCompanySubmitting] = useState(false);
  const [updateCompanySubmitting, setUpdateCompanySubmitting] = useState(false);
  const [deleteCompanySubmitting, setDeleteCompanySubmitting] = useState(false);
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false);
  const [repairUsersSubmitting, setRepairUsersSubmitting] = useState(false);

  useEffect(() => {
    try {
      const previousBuildId = window.localStorage.getItem(CACHE_BUILD_KEY);
      const reloadGuard = window.sessionStorage.getItem(CACHE_RELOAD_GUARD_KEY);

      if (previousBuildId && previousBuildId !== APP_BUILD_ID && reloadGuard !== APP_BUILD_ID) {
        window.localStorage.setItem(CACHE_BUILD_KEY, APP_BUILD_ID);
        window.sessionStorage.setItem(CACHE_RELOAD_GUARD_KEY, APP_BUILD_ID);
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.getRegistrations().then((registrations) => {
            registrations.forEach((registration) => registration.unregister());
          });
        }
        const url = new URL(window.location.href);
        url.searchParams.set("v", APP_BUILD_ID);
        window.location.replace(url.toString());
        return;
      }

      window.localStorage.setItem(CACHE_BUILD_KEY, APP_BUILD_ID);
      if (reloadGuard === APP_BUILD_ID) {
        window.sessionStorage.removeItem(CACHE_RELOAD_GUARD_KEY);
      }
    } catch {
      // Ignore storage errors and continue app initialization.
    }
  }, []);

  const tableConfig = getTableConfig(selectedTable);
  const isMaster = userRole === "master";

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
        .select("username,email,company_id")
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
      .select("user_id,username,email,role,company_id,db_url,db_anon_key,created_at,updated_at,created_by")
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
      .select("id,name,created_at")
      .order("name", { ascending: true });

    if (companiesError) {
      setCompaniesError(companiesError.message || "Nepodarilo sa načítať firmy.");
      setCompanies([]);
      return;
    }

    setCompanies(data || []);
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
      .insert([{ name }])
      .select("id,name,created_at")
      .single();

    if (createError) {
      setCompaniesError(createError.message || "Nepodarilo sa vytvoriť firmu.");
      setCreateCompanySubmitting(false);
      return;
    }

    setNewCompanyName("");
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
    setCompaniesError("");
  };

  const handleCancelEditCompany = () => {
    setEditingCompanyId("");
    setEditingCompanyName("");
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
      .update({ name })
      .eq("id", companyId)
      .select("id,name,created_at")
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
      .update({ role: nextRole })
      .eq("user_id", row.user_id);

    if (updateError) {
      setManagedUsersError(updateError.message || "Nepodarilo sa zmeniť rolu.");
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

  const fetchAllRows = async (table, config, options = {}) => {
    const { scopedCompanyId = null, selectClause = "*", historyFromMs = null } = options;
    const pageSize = 1000;
    let from = 0;
    let collected = [];

    while (true) {
      let query = supabase.from(table).select(selectClause).range(from, from + pageSize - 1);
      if (scopedCompanyId && (table === "stock" || table === "stock_history")) {
        query = query.eq("company_id", scopedCompanyId);
      }
      if (historyFromMs && table === "stock_history") {
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
    setLoading(true);
    setError("");

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
      // For non-master users, do not hard-block when local company state is missing.
      // RLS safely scopes rows by auth.uid() on the backend.

      const config = getTableConfig(table);
      const data =
        table === "stock"
          ? await fetchAllRows(table, config, {
              scopedCompanyId,
              selectClause: "company_id,position,material_code,quantity"
            })
          : await fetchAllRows(table, config, { scopedCompanyId });
      setRows(data || []);

      if (table !== "stock") {
        setDeadStockByKey({});
        setStockAgeStats({ avgDays: null, sampleCount: 0 });
        return;
      }

      const historyRows = await fetchAllRows("stock_history", getTableConfig("stock_history"), {
        scopedCompanyId,
        selectClause: "company_id,action,position,material_code,created_at_ms",
        historyFromMs: Date.now() - HISTORY_ANALYTICS_LOOKBACK_DAYS * DAY_MS
      });
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
      for (const stockRow of data || []) {
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
      setDeadStockByKey(deadMap);
      setStockAgeStats({
        avgDays: ageSamples > 0 ? ageTotalMs / ageSamples / DAY_MS : null,
        sampleCount: ageSamples
      });
      setLastDataLoadAt(Date.now());
      setLastLoadError("");
    } catch (queryError) {
      const loadErrorMessage = queryError?.message || "Nepodarilo sa načítať dáta.";
      setError(loadErrorMessage);
      setRows([]);
      setDeadStockByKey({});
      setStockAgeStats({ avgDays: null, sampleCount: 0 });
      setLastLoadError(loadErrorMessage);
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
    let mounted = true;
    let hydrationSequence = 0;
    const initTimeout = window.setTimeout(() => {
      if (!mounted) {
        return;
      }
      setAuthInitTimedOut(true);
      setAuthReady(true);
      setAuthError((prev) => prev || "Auth init timeout. Skontroluj Vercel env a Supabase dostupnosť.");
    }, AUTH_INIT_TIMEOUT_MS);

    const hydrateFromSession = async (session) => {
      const currentHydrationId = hydrationSequence + 1;
      hydrationSequence = currentHydrationId;
      const user = session?.user || null;
      if (!mounted || currentHydrationId !== hydrationSequence) {
        return;
      }

      setIsLoggedIn(Boolean(user));
      setAuthUser(user);
      if (!user) {
        setUserRole("user");
        setAuthUsername("");
        setUserCompanyId(null);
        setSelectedCompanyId("all");
      } else {
        const [resolvedRole, dbMasterFlag, companyFromRpc] = await Promise.all([
          resolveUserRole(user),
          fetchDbMasterFlagViaRpc(user.id),
          fetchOwnCompanyIdViaRpc(user.id)
        ]);
        if (!mounted || currentHydrationId !== hydrationSequence) {
          return;
        }
        const role = resolvedRole === "master" || dbMasterFlag ? "master" : "user";
        setUserRole(role);
        if (role === "master") {
          await ensureOwnRoleRow(user, role);
        }
        const ownRow = await fetchOwnRoleRow(user.id);
        if (!mounted || currentHydrationId !== hydrationSequence) {
          return;
        }
        const fallbackUsername = usernameFromInternalEmail(user.email);
        setAuthUsername(String(ownRow?.username || usernameFromInternalEmail(ownRow?.email) || fallbackUsername || ""));
        const resolvedCompanyId = ownRow?.company_id || companyFromRpc || null;
        setUserCompanyId(resolvedCompanyId);
        if (role !== "master") {
          setSelectedCompanyId(resolvedCompanyId || "");
        }
      }
      setAuthReady(true);
      setAuthInitTimedOut(false);
    };

    const init = async () => {
      try {
        const { data, error: sessionError } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_INIT_TIMEOUT_MS,
          "Auth session request timeout"
        );
        if (sessionError) {
          throw sessionError;
        }
        await hydrateFromSession(data?.session || null);
      } catch (initError) {
        if (!mounted) {
          return;
        }
        setIsLoggedIn(false);
        setAuthUser(null);
        setUserRole("user");
        setAuthUsername("");
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
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        setLastAuthEvent(String(event || "unknown"));
        setLastAuthEventAt(Date.now());
        await hydrateFromSession(session || null);
      } catch (stateError) {
        if (!mounted) {
          return;
        }
        setAuthReady(true);
        setAuthError(`Auth state error: ${stateError?.message || "neznáma chyba"}`);
      }
    });

    return () => {
      mounted = false;
      window.clearTimeout(initTimeout);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) {
      return undefined;
    }

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
      channel.on("postgres_changes", { event: "*", schema: "public", table: "stock_history" }, scheduleReload);
    }
    channel.subscribe();

    return () => {
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
      supabase.removeChannel(channel);
    };
  }, [selectedTable, isLoggedIn, deadStockDays, authReady, selectedCompanyId, userCompanyId, isMaster, authUser?.id]);

  useEffect(() => {
    if (!authReady || !isLoggedIn) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      loadRows(selectedTable);
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoggedIn, selectedTable, deadStockDays, authReady, selectedCompanyId, userCompanyId, isMaster, authUser?.id]);

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
    if (tableConfig.timeKeys.length === 0) {
      return "-";
    }

    const candidate = rows
      .map((row) => pickValue(row, tableConfig.timeKeys))
      .find((value) => value !== null && value !== undefined);

    return candidate ? formatDate(candidate) : "-";
  }, [rows, tableConfig.timeKeys]);

  const companyNameById = useMemo(
    () =>
      Object.fromEntries(
        companies.map((company) => [company.id, company.name])
      ),
    [companies]
  );

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
    return new Set(
      rows
        .map((row) => {
          const position = String(row.position || "").trim();
          if (!position) {
            return "";
          }
          return isMaster && selectedCompanyId === "all" ? `${row.company_id}::${position}` : position;
        })
        .filter(Boolean)
    ).size;
  }, [rows, selectedTable, isMaster, selectedCompanyId]);
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
  const currentCompanyLabel = useMemo(() => {
    if (isMaster) {
      return selectedCompanyId === "all" ? "Všetky firmy" : companyNameById[selectedCompanyId] || "Firma";
    }
    return companyNameById[userCompanyId] || "Bez firmy";
  }, [isMaster, selectedCompanyId, companyNameById, userCompanyId]);

  const togglePositionExpanded = (position) => {
    setExpandedPositions((prev) => ({ ...prev, [position]: !prev[position] }));
  };

  const runDiagnostics = async () => {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const sessionUser = sessionData?.session?.user || null;
      const uid = sessionUser?.id || authUser?.id || null;

      const [masterRpc, companyRpc, ownUserRow, companyRows, stockSample] = await Promise.all([
        uid ? supabase.rpc("is_master", { uid }) : Promise.resolve({ data: null, error: null }),
        uid ? supabase.rpc("user_company_id", { uid }) : Promise.resolve({ data: null, error: null }),
        uid
          ? supabase.from(ROLE_TABLE).select("user_id,role,company_id,username,email").eq("user_id", uid).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase.from("companies").select("id,name").order("name", { ascending: true }).limit(10),
        supabase.from("stock").select("company_id,position,material_code").limit(1)
      ]);

      setDiagResult({
        at: new Date().toISOString(),
        appBuildId: APP_BUILD_ID,
        authState: {
          authReady,
          isLoggedIn,
          authUserId: authUser?.id || null,
          authUserEmail: authUser?.email || null,
          authUsername,
          userRole,
          userCompanyId,
          selectedCompanyId,
          lastAuthEvent,
          lastAuthEventAt: lastAuthEventAt ? new Date(lastAuthEventAt).toISOString() : null
        },
        lastDataLoadAt: lastDataLoadAt ? new Date(lastDataLoadAt).toISOString() : null,
        rowsInView: rows.length,
        lastLoadError,
        browser: {
          online: typeof navigator !== "undefined" ? navigator.onLine : true,
          url: typeof window !== "undefined" ? window.location.href : ""
        },
        checks: {
          session: {
            ok: !sessionError,
            error: sessionError?.message || null,
            uid: sessionUser?.id || null,
            email: sessionUser?.email || null
          },
          rpcIsMaster: { ok: !masterRpc.error, data: masterRpc.data ?? null, error: masterRpc.error?.message || null },
          rpcUserCompanyId: {
            ok: !companyRpc.error,
            data: companyRpc.data ?? null,
            error: companyRpc.error?.message || null
          },
          ownUserRow: { ok: !ownUserRow.error, data: ownUserRow.data ?? null, error: ownUserRow.error?.message || null },
          companiesSelect: {
            ok: !companyRows.error,
            count: Array.isArray(companyRows.data) ? companyRows.data.length : 0,
            sample: companyRows.data || [],
            error: companyRows.error?.message || null
          },
          stockSelect: {
            ok: !stockSample.error,
            sample: stockSample.data || [],
            error: stockSample.error?.message || null
          }
        }
      });
    } catch (diagError) {
      setDiagResult({
        at: new Date().toISOString(),
        fatal: diagError?.message || "Diagnostic run failed."
      });
    } finally {
      setDiagRunning(false);
    }
  };

  const handleLocalAuthCacheReset = () => {
    try {
      const localKeys = Object.keys(window.localStorage);
      localKeys.forEach((key) => {
        if (key.startsWith("wms_") || key.toLowerCase().includes("supabase")) {
          window.localStorage.removeItem(key);
        }
      });

      const sessionKeys = Object.keys(window.sessionStorage);
      sessionKeys.forEach((key) => {
        if (key.startsWith("wms_") || key.toLowerCase().includes("supabase")) {
          window.sessionStorage.removeItem(key);
        }
      });
    } catch {
      // Ignore storage cleanup errors.
    }
    window.location.reload();
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
    setAuthInitTimedOut(false);
    setAuthReady(true);
    const email = resolveLoginEmail(authUsernameInput);

    if (!email) {
      setAuthError("Zadaj platný login.");
      setAuthSubmitting(false);
      return;
    }

    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Ignore local sign-out cleanup failure before fresh login.
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: authPassword });

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
    setSelectedCompanyId("all");
    setRows([]);
    setError("");
    setLoading(false);
    setIsSettingsOpen(false);
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
          <div className="hero-badges">
            <span className="table-badge">{selectedTable}</span>
            {isMaster && <span className="table-badge table-badge-master">master</span>}
            <span className="table-badge">{authUsername || "user"}</span>
            <span className="table-badge">{currentCompanyLabel}</span>
          </div>
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
            {isMaster && (
              <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}>
                <option value="all">Všetky firmy</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            )}
            {isMaster && (
              <button type="button" onClick={() => setIsSettingsOpen(true)} className="settings-btn">
                Nastavenia
              </button>
            )}
            <button type="button" onClick={exportToExcel} className="export-btn">
              Export do Excelu
            </button>
            <button type="button" onClick={() => setDiagOpen((prev) => !prev)} className="refresh-btn">
              {diagOpen ? "Skryť diagnostiku" : "Diagnostika"}
            </button>
            <button type="button" onClick={() => loadRows(selectedTable)} className="refresh-btn">
              Obnoviť
            </button>
            <button type="button" onClick={handleSignOut} className="logout-btn" disabled={signOutSubmitting}>
              Odhlásiť sa
            </button>
          </div>
        </div>
      </section>

      {diagOpen && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Troubleshooting</h2>
              <p className="panel-meta">Rýchla diagnostika relácie a SQL prístupu</p>
            </div>
            <div className="master-head-actions">
              <button type="button" className="refresh-btn" onClick={runDiagnostics} disabled={diagRunning}>
                {diagRunning ? "Beží..." : "Spustiť test"}
              </button>
              <button
                type="button"
                className="refresh-btn"
                onClick={async () => {
                  await supabase.auth.getSession();
                  await loadRows(selectedTable);
                }}
              >
                Force reload
              </button>
              <button type="button" className="logout-btn" onClick={handleLocalAuthCacheReset}>
                Reset local cache
              </button>
            </div>
          </div>
          <p className="panel-meta">
            Posledný auth event: {lastAuthEvent} | Posledné načítanie: {lastDataLoadAt ? formatDate(lastDataLoadAt) : "-"}
          </p>
          {lastLoadError && <p className="error">{`Load error: ${lastLoadError}`}</p>}
          <div className="table-wrap">
            <pre className="debug-json">{JSON.stringify(diagResult || { info: "Klikni na Spustiť test" }, null, 2)}</pre>
          </div>
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
            <button type="submit" className="settings-btn" disabled={createUserSubmitting}>
              {createUserSubmitting ? "Vytváram..." : "Vytvoriť účet"}
            </button>
          </form>

          {managedUsersError && <p className="error">{managedUsersError}</p>}
          {companiesError && <p className="error">{companiesError}</p>}

          <div className="table-wrap">
            <table className="master-users-table">
              <thead>
                <tr>
                  <th>Firma</th>
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

          <div className="table-wrap">
            <table className="master-users-table">
              <thead>
                <tr>
                  <th>Login</th>
                  <th>Rola</th>
                  <th>Firma</th>
                  <th>Supabase</th>
                  <th>Vytvorené</th>
                  <th>Zmena role</th>
                </tr>
              </thead>
              <tbody>
                {managedUsers.map((row) => (
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
                          {tableConfig.columns.map((column) => {
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

      {isMaster && isSettingsOpen && (
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
