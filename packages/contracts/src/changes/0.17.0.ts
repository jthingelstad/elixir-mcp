import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.17.0",
  date: "2026-09-05",
  summary:
    "The entitlement ladder and the push lane. Roles (member/leader/family/partner/admin) set collection and call-volume quotas - roles NEVER gate visibility, universal reads stands; see the public Roles doc. elixir_events: your per-account event feed (event types - schema, not news: battles_recorded, feedback_responded, recording lifecycle, role_changed, clan_war_week_finished) with implicit subscriptions - watching something IS subscribing; meta.events_pending hints when there is something new. Tier upgrades are self-serve on the website.",
  tools_added: ["elixir_events"],
} satisfies ChangelogEntry;
