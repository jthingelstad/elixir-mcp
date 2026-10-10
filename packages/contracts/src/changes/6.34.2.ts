import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.34.2",
  date: "2026-09-23",
  summary:
    "An elixir_timeline page is sized to fit the result cap as well as the 150-item cap. Items are taken in the order they were observed until the page reaches 40,000 characters, and the cut falls on the first item that would not fit: the same `observed_at` cut, so `next_cursor` pages on exactly. A 7-day compact read of a busy clan had exceeded the cap, since a standout carries the whole session shape.",
} satisfies ChangelogEntry;
