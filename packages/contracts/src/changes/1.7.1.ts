import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.7.1",
  date: "2026-09-11",
  summary:
    "Scoped battle intelligence now uses the participant-time index for player, clan and collection windows instead of filtering time only after joining back to battles. battles_meta_cards also derives its denominator from the same card expansion rather than scanning the scoped observations a second time. This fixes an observed burst where four concurrent clan/collection card-meta calls exhausted the MCP Lambda's 25-second limit. Response meta now includes events_pending: 0 and feedback_responses_pending: 0 when each queue is empty, restoring the EVERY-response promise made in 1.0.0 and letting scheduled consumers skip empty ledger reads.",
  tools_added: [],
} satisfies ChangelogEntry;
