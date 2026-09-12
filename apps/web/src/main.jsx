import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { takeLoginToken } from "./url-hygiene.js";
import { loadTinylytics, trackEvent, analyticsLocation } from "./analytics.js";
import "@elixir-mcp/design/styles.css";

// Before anything renders: lift any magic token out of the address bar, so it
// cannot reach history, a bookmark or a Referer. It is held in memory for the
// sign-in view, which is the part that used to be missing — the scrub ran
// first and the view then found nothing to redeem.
takeLoginToken();
// Only after that: the embed must never see ?login_token in the address bar.
loadTinylytics();
// A script error or an unhandled rejection in the view is a failure the
// origin never hears about. The value is the PAGE (already scrubbed of
// ids by analyticsLocation) and the error's name — never its message,
// which can quote a URL.
const reportError = (kind) => (ev) => {
  const err = ev.reason ?? ev.error;
  const name = err?.name && err.name !== "Error" ? err.name : kind;
  trackEvent("web.error", `${name} ${analyticsLocation()?.path ?? "-"}`);
};
window.addEventListener("error", reportError("error"));
window.addEventListener("unhandledrejection", reportError("rejection"));
createRoot(document.getElementById("root")).render(<App />);
