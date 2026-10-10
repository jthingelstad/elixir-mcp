import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.0.1",
  date: "2026-10-02",
  summary:
    "cards_card reads earliest selected-history play from shared deck identities instead of joining every played-card occurrence. Base, Evolution, Hero and duel-round history retain the same factual meaning. No response fields or JSON API operations change.",
} satisfies ChangelogEntry;
