import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, Factory, LogOut, PlayCircle, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { clearSupabaseAuthStorage, supabase } from "../../supabaseClient";
import FactoryOsMesDashboard from "./FactoryOsMesDashboard";
import "./mesTenant.css";

const INTERNAL_LOGIN_DOMAIN = String(import.meta.env.VITE_INTERNAL_LOGIN_DOMAIN || "wms.local").trim().toLowerCase();

function normalizeName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resolveLoginEmail(value) {
  const login = String(value || "").trim().toLowerCase();
  if (!login) return "";
  if (login.includes("@")) return login;
  const username = login.replace(/[^a-z0-9._-]+/g, "");
  return username ? `${username}@${INTERNAL_LOGIN_DOMAIN}` : "";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("sk-SK", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

const formatNumber = (value) => new Intl.NumberFormat("sk-SK").format(Number(value || 0));

function isCompanyAllowed(tenant, company) {
  if (tenant.companyId) return String(company?.id || "") === tenant.companyId;
  const companyName = normalizeName(company?.name);
  return (tenant.companyNameFragments || []).some((fragment) => companyName.includes(normalizeName(fragment)));
}

function getMachineState(row) {
  const state = String(row.machine_state || row.job_status || "idle").toLowerCase();
  if (state === "running") return { key: "running", label: "Výroba" };
  if (state === "downtime" || state === "paused" || row.current_downtime_reason) return { key: "downtime", label: "Prestoj" };
  if (state === "offline") return { key: "offline", label: "Offline" };
  return { key: "idle", label: "Pripravené" };
}

export default function MesTenantApp({ tenant }) {
  const [authState, setAuthState] = useState("loading");
  const [accessContext, setAccessContext] = useState(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [activeView, setActiveView] = useState("overview");
  const [overviewRows, setOverviewRows] = useState([]);
  const [jobRuns, setJobRuns] = useState([]);
  const [mesEvents, setMesEvents] = useState([]);
  const [workstations, setWorkstations] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const hydrationIdRef = useRef(0);
  const branding = tenant.branding || {};

  useEffect(() => {
    document.title = branding.productName || "MES";
  }, [branding.productName]);

  const hydrateSession = useCallback(async (session) => {
    const hydrationId = ++hydrationIdRef.current;
    setAccessContext(null);
    setAuthError("");
    if (!session?.user) {
      setAuthState("anonymous");
      return;
    }

    setAuthState("loading");
    const { data: profile, error: profileError } = await supabase
      .from("app_users")
      .select("user_id,username,email,role,company_id,can_access_mes")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (hydrationId !== hydrationIdRef.current) return;
    if (profileError || !profile) {
      setAuthError(profileError?.message || "Používateľ nemá vytvorený firemný profil.");
      setAuthState("denied");
      return;
    }

    const isMaster = String(profile.role || "").toLowerCase() === "master";
    const companyId = tenant.companyId || profile.company_id || "";
    if (!companyId || (!isMaster && tenant.companyId && profile.company_id !== tenant.companyId)) {
      setAuthError("Tento účet nepatrí firme priradenej k tejto MES doméne.");
      setAuthState("denied");
      return;
    }
    if (!isMaster && !profile.can_access_mes) {
      setAuthError("Tento účet nemá povolený prístup do MES.");
      setAuthState("denied");
      return;
    }

    const { data: company, error: companyError } = await supabase
      .from("companies").select("id,name,mes_enabled").eq("id", companyId).maybeSingle();
    if (hydrationId !== hydrationIdRef.current) return;
    if (companyError || !company || !isCompanyAllowed(tenant, company)) {
      setAuthError(companyError?.message || "Firma účtu nezodpovedá tejto MES doméne.");
      setAuthState("denied");
      return;
    }
    if (!isMaster && !company.mes_enabled) {
      setAuthError("MES modul nie je pre túto firmu aktívny.");
      setAuthState("denied");
      return;
    }

    setAccessContext({ company, profile, isMaster });
    setAuthState("authenticated");
  }, [tenant]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setAuthError(error.message || "Reláciu sa nepodarilo overiť.");
        setAuthState("anonymous");
      } else {
        void hydrateSession(data?.session || null);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => mounted && void hydrateSession(session || null), 0);
    });
    return () => {
      mounted = false;
      hydrationIdRef.current += 1;
      subscription.unsubscribe();
    };
  }, [hydrateSession]);

  const loadMesData = useCallback(async () => {
    const companyId = accessContext?.company?.id;
    if (!companyId) return;
    setDataLoading(true);
    setDataError("");
    try {
      const historyStartAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const [overviewResult, runsResult, eventsResult, workstationsResult] = await Promise.all([
        supabase.rpc("mes_factory_overview", { p_company_id: companyId }),
        supabase.from("mes_job_runs")
          .select("id,workstation_id,machine_id,terminal_id,operator_user_id,job_number,item_code,item_name,operator_name,status,planned_quantity,good_quantity,scrap_quantity,setup_started_at,started_at,ended_at,note,created_at,updated_at")
          .eq("company_id", companyId).order("created_at", { ascending: false }).limit(500),
        supabase.from("mes_event_log")
          .select("id,terminal_id,workstation_id,job_run_id,event_code,job_number,duration_seconds,time_from,time_to,operator_id,downtime_reason_code,downtime_reason_name,payload,created_at")
          .eq("company_id", companyId).gte("created_at", historyStartAt).order("created_at", { ascending: false }).limit(5000),
        supabase.from("mes_workstations")
          .select("id,code,name,area,target_cycle_seconds,ideal_units_per_hour")
          .eq("company_id", companyId).eq("is_active", true)
      ]);
      if (overviewResult.error) throw overviewResult.error;
      if (runsResult.error) throw runsResult.error;
      if (eventsResult.error) throw eventsResult.error;
      if (workstationsResult.error) throw workstationsResult.error;
      setOverviewRows(overviewResult.data || []);
      setJobRuns(runsResult.data || []);
      setWorkstations(workstationsResult.data || []);
      const runById = new Map((runsResult.data || []).map((run) => [String(run.id || ""), run]));
      setMesEvents((eventsResult.data || []).map((event) => {
        const run = runById.get(String(event.job_run_id || "")) || null;
        return {
          ...event,
          event_type: event.event_code,
          happened_at: event.time_to || event.created_at,
          operator_name: event.payload?.operator_name || "",
          machine_id: run?.machine_id || "",
          workstation_id: event.workstation_id || run?.workstation_id || "",
          terminal_id: event.terminal_id || run?.terminal_id || ""
        };
      }));
      setLastLoadedAt(new Date());
    } catch (error) {
      setOverviewRows([]);
      setJobRuns([]);
      setMesEvents([]);
      setWorkstations([]);
      setDataError(error?.message || "MES dáta sa nepodarilo načítať.");
    } finally {
      setDataLoading(false);
    }
  }, [accessContext?.company?.id]);

  useEffect(() => {
    if (authState !== "authenticated") return undefined;
    void loadMesData();
    const intervalId = window.setInterval(() => void loadMesData(), Math.max(10_000, Number(tenant.refreshIntervalMs || 30_000)));
    return () => window.clearInterval(intervalId);
  }, [authState, loadMesData, tenant.refreshIntervalMs]);

  const summary = useMemo(() => overviewRows.reduce((result, row) => {
    const state = getMachineState(row).key;
    result.workstations += 1;
    result.running += state === "running" ? 1 : 0;
    result.downtime += state === "downtime" ? 1 : 0;
    result.good += Number(row.good_quantity || 0);
    result.scrap += Number(row.scrap_quantity || 0);
    return result;
  }, { workstations: 0, running: 0, downtime: 0, good: 0, scrap: 0 }), [overviewRows]);

  const handleSignIn = async (event) => {
    event.preventDefault();
    const email = resolveLoginEmail(login);
    if (!email || !password) {
      setAuthError("Zadaj login a heslo.");
      return;
    }
    setAuthSubmitting(true);
    setAuthError("");
    try {
      clearSupabaseAuthStorage();
      await supabase.auth.signOut({ scope: "local" });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setPassword("");
    } catch (error) {
      setAuthError(error?.message || "Prihlásenie zlyhalo.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
    setOverviewRows([]);
    setJobRuns([]);
    setMesEvents([]);
    setWorkstations([]);
    setAccessContext(null);
  };

  const tenantStyle = { "--tenant-accent": branding.accent || "#146c5a", "--tenant-accent-strong": branding.accentStrong || "#0a4f41" };

  if (authState === "loading") {
    return <main className="mes-tenant mes-tenant-centered" style={tenantStyle}><RefreshCw className="mes-tenant-spinner" /><p>Overujem MES prístup...</p></main>;
  }

  if (authState === "anonymous") {
    return (
      <main className={`mes-tenant mes-tenant-login ${tenant.uiVariant === "factory-os" ? "factory-os-login" : ""}`} style={tenantStyle}>
        <section className="mes-tenant-login-card">
          <div className="mes-tenant-brandmark"><Factory size={26} /></div>
          <p className="mes-tenant-eyebrow">{branding.eyebrow || "MES"}</p>
          <h1>{branding.productName || "MES"}</h1>
          <p className="mes-tenant-login-copy">Prihlásenie do výrobného prostredia firmy.</p>
          <form onSubmit={handleSignIn} className="mes-tenant-login-form">
            <label><span>Login</span><input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" autoFocus /></label>
            <label><span>Heslo</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
            {authError && <p className="mes-tenant-error"><AlertTriangle size={16} />{authError}</p>}
            <button type="submit" disabled={authSubmitting}><ShieldCheck size={17} />{authSubmitting ? "Prihlasujem..." : "Prihlásiť do MES"}</button>
          </form>
        </section>
      </main>
    );
  }

  if (authState === "denied") {
    return <main className="mes-tenant mes-tenant-centered" style={tenantStyle}><AlertTriangle size={34} /><h1>Prístup zamietnutý</h1><p>{authError}</p><button type="button" className="mes-tenant-secondary-button" onClick={handleSignOut}>Odhlásiť účet</button></main>;
  }

  if (tenant.uiVariant === "factory-os") {
    return (
      <FactoryOsMesDashboard
        tenant={tenant}
        accessContext={accessContext}
        overviewRows={overviewRows}
        jobRuns={jobRuns}
        mesEvents={mesEvents}
        workstations={workstations}
        dataLoading={dataLoading}
        dataError={dataError}
        lastLoadedAt={lastLoadedAt}
        onRefresh={loadMesData}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <main className="mes-tenant" style={tenantStyle}>
      <header className="mes-tenant-header">
        <div className="mes-tenant-brand"><span className="mes-tenant-brandmark"><Factory size={22} /></span><div><p>{branding.eyebrow || "MES"}</p><strong>{branding.productName || "MES"}</strong></div></div>
        <div className="mes-tenant-session"><span><UserRound size={15} />{accessContext.profile.username || accessContext.profile.email}</span><button type="button" onClick={handleSignOut} aria-label="Odhlásiť"><LogOut size={17} /></button></div>
      </header>

      <section className="mes-tenant-toolbar">
        <div><p className="mes-tenant-eyebrow">{accessContext.company.name}</p><h1>Výrobný prehľad</h1><span>{lastLoadedAt ? `Aktualizované ${formatDateTime(lastLoadedAt)}` : "Načítavam aktuálny stav"}</span></div>
        <button type="button" className="mes-tenant-refresh" onClick={loadMesData} disabled={dataLoading}><RefreshCw size={17} className={dataLoading ? "mes-tenant-spinner" : ""} /> Obnoviť</button>
      </section>

      <nav className="mes-tenant-tabs" aria-label="MES navigácia">
        {tenant.features?.overview && <button type="button" className={activeView === "overview" ? "active" : ""} onClick={() => setActiveView("overview")}><BarChart3 size={17} />Prehľad</button>}
        {tenant.features?.activity && <button type="button" className={activeView === "activity" ? "active" : ""} onClick={() => setActiveView("activity")}><Activity size={17} />Výroba</button>}
      </nav>

      {dataError && <p className="mes-tenant-error mes-tenant-data-error"><AlertTriangle size={16} />{dataError}</p>}
      {activeView === "overview" && <>
        <section className="mes-tenant-kpis">
          <article><Factory /><span>Pracoviská</span><strong>{formatNumber(summary.workstations)}</strong></article>
          <article><PlayCircle /><span>Vo výrobe</span><strong>{formatNumber(summary.running)}</strong></article>
          <article><Clock3 /><span>Prestoje</span><strong>{formatNumber(summary.downtime)}</strong></article>
          <article><CheckCircle2 /><span>Dobré kusy</span><strong>{formatNumber(summary.good)}</strong></article>
          <article><AlertTriangle /><span>NOK kusy</span><strong>{formatNumber(summary.scrap)}</strong></article>
        </section>
        <section className="mes-tenant-grid">
          {overviewRows.map((row) => {
            const state = getMachineState(row);
            return <article className="mes-tenant-machine" key={row.workstation_id}>
              <div className="mes-tenant-machine-head"><div><span>{row.workstation_code || "Pracovisko"}</span><h2>{row.machine_name || row.workstation_name}</h2></div><span className={`mes-tenant-state ${state.key}`}>{state.label}</span></div>
              <dl><div><dt>Výrobná zákazka</dt><dd>{row.job_number || "Bez aktívnej zákazky"}</dd></div><div><dt>Výrobok</dt><dd>{row.item_name || row.item_code || "-"}</dd></div><div><dt>Operátor</dt><dd>{row.operator_name || "-"}</dd></div><div><dt>Vyrobené</dt><dd>{formatNumber(row.good_quantity)} / {formatNumber(row.planned_quantity)}</dd></div></dl>
              {row.current_downtime_reason && <p className="mes-tenant-downtime">{row.current_downtime_reason}</p>}
            </article>;
          })}
          {!dataLoading && overviewRows.length === 0 && <p className="mes-tenant-empty">Pre firmu zatiaľ nie sú dostupné MES pracoviská.</p>}
        </section>
      </>}

      {activeView === "activity" && <section className="mes-tenant-table-card"><div className="mes-tenant-table-wrap"><table><thead><tr><th>Zákazka</th><th>Výrobok</th><th>Operátor</th><th>Stav</th><th>OK</th><th>NOK</th><th>Začiatok</th></tr></thead><tbody>{jobRuns.map((run) => <tr key={run.id}><td>{run.job_number || "-"}</td><td>{run.item_name || run.item_code || "-"}</td><td>{run.operator_name || "-"}</td><td>{run.status || "-"}</td><td>{formatNumber(run.good_quantity)}</td><td>{formatNumber(run.scrap_quantity)}</td><td>{formatDateTime(run.started_at || run.created_at)}</td></tr>)}</tbody></table></div>{!dataLoading && jobRuns.length === 0 && <p className="mes-tenant-empty">Zatiaľ nie sú zaznamenané výrobné behy.</p>}</section>}
    </main>
  );
}
