import { CalendarDays } from "lucide-react";
import MesTenantApp from "../shared/MesTenantApp";
import ScherdelProductionPlanningDemo from "./ScherdelProductionPlanningDemo";
import "./scherdelMesDashboard.css";

function isStandalonePlanningPreview(location) {
  const hostname = String(location?.hostname || "").trim().toLowerCase();
  if (!hostname.endsWith(".vercel.app")) return false;
  return new URLSearchParams(location?.search || "").get("planningDemo") === "1";
}

export default function ScherdelMesApp({ tenant }) {
  if (isStandalonePlanningPreview(window.location)) {
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

        <section className="scherdel-hero">
          <div><p>Výrobný monitoring · C.E.P. Scherdel</p><h1>Riadenie a sledovanie výroby</h1><span>Samostatný náhľad plánovacieho modulu</span></div>
        </section>

        <nav className="scherdel-nav" aria-label="Testovacia MES navigácia">
          <button type="button" className="active"><CalendarDays size={17} />Plánovanie výroby</button>
        </nav>

        <ScherdelProductionPlanningDemo />
      </main>
    );
  }

  return <MesTenantApp tenant={tenant} />;
}
