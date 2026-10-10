import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.2.1",
  date: "2026-10-04",
  summary:
    "Weekly clan participation reads resolve participant side only inside the bounded boat-defense lookup, allowing the existing player/time covering index to serve ordinary battle rows without a broad heap scan. Current and former-member battle and ranked counts retain their exact meaning, including boat attacks and unknown boat-side evidence. Response shapes and JSON API 3.0.0 are unchanged.",
} satisfies ChangelogEntry;
