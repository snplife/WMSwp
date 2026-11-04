import { useEffect } from "react";
import MesTenantApp from "../shared/MesTenantApp";
import ScherdelProductionPlanningDemo from "./ScherdelProductionPlanningDemo";
import "./scherdelMesDashboard.css";

function isStandalonePlanningPreview(location) {
  const hostname = String(location?.hostname || "").trim().toLowerCase();
  if (hostname === "scherdel-planning-demo.vercel.app") return true;
  if (!import.meta.env.DEV && !hostname.endsWith(".vercel.app")) return false;
  return new URLSearchParams(location?.search || "").get("planningDemo") === "1";
}

export default function ScherdelMesApp({ tenant }) {
  const standalonePlanningPreview = isStandalonePlanningPreview(window.location);

  useEffect(() => {
    if (standalonePlanningPreview) document.title = "SCHERDEL | Plánovanie výroby";
  }, [standalonePlanningPreview]);

  if (standalonePlanningPreview) {
    return (
      <main className="scherdel-mes" style={{ "--scherdel-accent": tenant.branding?.accent || "#0067a8" }}>
        <header className="scherdel-topbar">
          <div className="scherdel-brand">
            <img className="scherdel-company-logo" src={tenant.branding?.companyLogo} alt="SCHERDEL" />
            <span aria-hidden="true" />
            <img className="scherdel-platform-logo" src={tenant.branding?.platformLogo} alt="MESLULA" />
            <small>Manufacturing Execution System</small>
          </div>
          <div className="scherdel-user"><span>Planning demo</span></div>
        </header>

        <section className="scherdel-hero planning-preview-hero">
          <div>
            <p><i aria-hidden="true" /> SCHERDEL · výrobný plán</p>
            <h1>Plán, ktorý rešpektuje<br /><em>realitu výroby.</em></h1>
            <span>Kapacita strojov, materiálové väzby a termíny zákaziek v jednom pracovnom pohľade.</span>
          </div>
          <aside className="planning-preview-status" aria-label="Ukážka kapacitného plánu">
            <header><span>factory-os / planning</span><b><i aria-hidden="true" /> LIVE</b></header>
            <div className="planning-console-head"><small>HALA A · TÝŽDEŇ 45</small><strong>Kapacitný plán výroby</strong></div>
            <dl><div><dt>Kapacita</dt><dd>1 000 <small>h</small></dd></div><div><dt>Stroje</dt><dd>9 <small>aktívnych</small></dd></div><div><dt>Backlog</dt><dd>144 <small>dávok</small></dd></div></dl>
            <div className="planning-console-chart" aria-hidden="true"><span style={{ "--bar": "38%" }} /><span style={{ "--bar": "61%" }} /><span style={{ "--bar": "48%" }} /><span style={{ "--bar": "72%" }} /><span style={{ "--bar": "57%" }} /><span style={{ "--bar": "83%" }} /><span style={{ "--bar": "69%" }} /></div>
            <footer><span><i /> Ohýbanie</span><span><i /> Zváranie</span><span><i /> Kontrola</span></footer>
          </aside>
        </section>

        <ScherdelProductionPlanningDemo />
      </main>
    );
  }

  return <MesTenantApp tenant={tenant} />;
}
