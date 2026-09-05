import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
// The baked crawlable block has done its job once the app is up.
document.getElementById("prerender")?.remove();
