import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.29.0",
  date: "2026-09-08",
  summary:
    "Every response now carries meta.request_id, naming the audit row that produced it — quote it when reporting an answer that looks wrong. Calls made with a service token are recorded against that token, not just the account behind it.",
} satisfies ChangelogEntry;
