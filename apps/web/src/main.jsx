import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { takeLoginToken } from "./url-hygiene.js";
import { loadTinylytics } from "./analytics.js";
import "@elixir-mcp/design/styles.css";

// Before anything renders: lift any magic token out of the address bar, so it
// cannot reach history, a bookmark or a Referer. It is held in memory for the
// sign-in view, which is the part that used to be missing — the scrub ran
// first and the view then found nothing to redeem.
takeLoginToken();
// Only after that: the embed must never see ?login_token in the address bar.
loadTinylytics();
createRoot(document.getElementById("root")).render(<App />);
