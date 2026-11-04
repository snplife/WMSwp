import { useEffect } from "react";
import MesTenantApp from "../shared/MesTenantApp";
import ScherdelProductionPlanningDemo from "./ScherdelProductionPlanningDemo";
import "./scherdelMesDashboard.css";

function isStandalonePlanningPreview(location) {
  const hostname = String(location?.hostname || "").trim().toLowerCase();
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
          <div className="scherdel-user"><span>Testovacia verzia</span></div>
        </header>

        <section className="scherdel-hero planning-preview-hero">
          <div>
            <p><i aria-hidden="true" /> SCHERDEL · výrobný plán</p>
            <h1>Plán, ktorý rešpektuje<br /><em>realitu výroby.</em></h1>
            <span>Kapacita strojov, materiálové väzby a termíny zákaziek v jednom pracovnom pohľade.</span>
          </div>
          <aside className="planning-preview-status">
            <span><i aria-hidden="true" /> Interaktívne demo</span>
            <b>Lokálny plánovací scenár</b>
            <small>Zmeny zostávajú iba v tomto prehliadači.</small>
          </aside>
        </section>

        <ScherdelProductionPlanningDemo />
      </main>
    );
  }

  return <MesTenantApp tenant={tenant} />;
}
