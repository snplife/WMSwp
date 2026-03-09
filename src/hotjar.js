const HOTJAR_ID = Number.parseInt(String(import.meta.env.VITE_HOTJAR_ID || "6664458").trim(), 10);
const HOTJAR_SNIPPET_VERSION = Number.parseInt(String(import.meta.env.VITE_HOTJAR_SNIPPET_VERSION || "6").trim(), 10);

export function installHotjar() {
  if (!import.meta.env.PROD) {
    return;
  }

  if (!Number.isFinite(HOTJAR_ID) || HOTJAR_ID <= 0) {
    return;
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  if (window.hj || document.querySelector('script[data-hotjar="true"]')) {
    return;
  }

  window.hj =
    window.hj ||
    function hotjarProxy() {
      (window.hj.q = window.hj.q || []).push(arguments);
    };

  window._hjSettings = {
    hjid: HOTJAR_ID,
    hjsv: Number.isFinite(HOTJAR_SNIPPET_VERSION) && HOTJAR_SNIPPET_VERSION > 0 ? HOTJAR_SNIPPET_VERSION : 6
  };

  const head = document.head || document.getElementsByTagName("head")[0];
  const script = document.createElement("script");
  script.async = true;
  script.dataset.hotjar = "true";
  script.src = `https://static.hotjar.com/c/hotjar-${window._hjSettings.hjid}.js?sv=${window._hjSettings.hjsv}`;
  head.appendChild(script);
}

export function uninstallHotjar() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const hotjarScript = document.querySelector('script[data-hotjar="true"]');
  if (hotjarScript) {
    hotjarScript.remove();
  }

  if (window.hj) {
    delete window.hj;
  }

  if (window._hjSettings) {
    delete window._hjSettings;
  }
}
