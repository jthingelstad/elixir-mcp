import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.2.0",
  date: "2026-10-04",
  tools_added: ["clans_context"],
  summary:
    "clans_context exposes only eight policy-context fields to an agent with an explicit credential-bound grant for its actual owner and assigned clan. Current verified owner membership, ownership, assignment and revocation are checked on every read. Missing or unspecified intent stays unknown; scoring does not imply intent. Private notes, decisions and other policy values remain unavailable. Standard scopes and JSON API 3.0.0 are unchanged. Refresh context at startup, before planning and immediately before firing affected routines; defer on unknown or error.",
} satisfies ChangelogEntry;
