import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.8.0",
  date: "2026-09-12",
  summary:
    "OAuth gains account:email and GET /oauth/userinfo, for web products in the Elixir family that sign a person in with Elixir. The scope is granted only to a client that names it: it is not part of the default grant, is never offered ticked on the consent page, cannot be widened into from a checkbox or from Account -> Connections, and is not advertised in a 401 challenge. userinfo answers { sub, email, email_verified: true, kind } for a live personal-door token holding it and nothing else. No tool changed; scopes_supported in both discovery documents now lists six.",
  tools_added: [],
} satisfies ChangelogEntry;
