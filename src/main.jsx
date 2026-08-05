import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { resolveTenant } from "./tenants/tenantRegistry";

async function bootstrap() {
  const tenant = resolveTenant(window.location);
  const appModule = tenant ? await tenant.loadApp() : await import("./App");
  const RootApp = appModule.default;

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <RootApp tenant={tenant} />
    </React.StrictMode>
  );
}

bootstrap().catch((error) => {
  console.error("Application bootstrap failed:", error);
  const root = document.getElementById("root");
  if (root) {
    root.textContent = "Aplikáciu sa nepodarilo spustiť. Skús obnoviť stránku.";
  }
});
