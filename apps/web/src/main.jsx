import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { loadTinylytics } from "./analytics.js";
import "@elixir-mcp/design/styles.css";

createRoot(document.getElementById("root")).render(<App />);
loadTinylytics();
