import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.24.0",
  date: "2026-09-06",
  summary:
    "collections_edit: curate a collection you own from an agent or a service token. add and remove adjust membership, set replaces it wholesale - the shape an external system syncing a roster wants. Everything in a collection is recorded for as long as it stays there, so adding a tag starts collecting it. Up to 500 tags per call, idempotent, and a malformed tag refuses the whole call rather than silently dropping somebody from a synced roster.",
  tools_added: ["collections_edit"],
} satisfies ChangelogEntry;
