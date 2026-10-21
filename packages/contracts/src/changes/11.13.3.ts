import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.13.3",
  date: "2026-10-21",
  summary: md(
    "Connecting no longer spends the hour. The MCP hourly bucket counts calls only: `tools/call`, `resources/read`, `prompts/get` and any method the door does not serve. A notification (answered HTTP 202), `initialize`, `ping`, `tools/list`, `resources/list`, `resources/templates/list` and `prompts/list` are still authenticated and are not counted, so a client that reconnects often keeps its whole hour for calls, and a spent hour still lets it connect and read the 429's reset.",
    list(
      "Which bucket a counted message spends from is unchanged: the principal's (each agent its own), or a key's own when it has a ceiling of its own.",
      "The daily tool-call quota already counted `tools/call` only; it is unchanged.",
      "An unsupported `MCP-Protocol-Version` is still refused with HTTP 400 and JSON-RPC -32600; the door's request log now records the version that was sent.",
    ),
    "No tool, field or argument changes. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
