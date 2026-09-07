import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { scrubLoginToken } from "./url-hygiene.js";
import "@elixir-mcp/design/styles.css";

// Before anything renders: a live magic token must not linger in the
// address bar. No third-party script is loaded here at all (#25).
scrubLoginToken();
createRoot(document.getElementById("root")).render(<App />);
