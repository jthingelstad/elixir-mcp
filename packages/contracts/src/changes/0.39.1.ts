import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.39.1",
  date: "2026-09-09",
  summary:
    "An agent's live fetches (live_fetch, players_profile live: true) are charged to its OWNER's daily live budget, matching how its tool calls were already charged, so every agent on one account shares one live allowance and meta.quota.live reads the same balance on each; previously each agent spent a live budget of its own. Roles gain a per-account agent count (member 3, leader 5, family 10, partner 25; admin and owner unlimited), enforced at creation with not_entitled and reason agent_limit. A refused OAuth access token at the MCP door now answers 401 with the WWW-Authenticate challenge instead of 500.",
} satisfies ChangelogEntry;
