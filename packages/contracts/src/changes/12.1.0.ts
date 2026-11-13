import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "12.1.0",
  date: "2026-11-13",
  summary: md(
    "Following's OAuth scope is `follows:write`, as the tools say follow (it was `recordings:write`). The old name is still accepted:",
    list(
      "A client that asks for `recordings:write` is granted `follows:write`; discovery's `scopes_supported`, the consent page, token responses and an insufficient_scope challenge name only `follows:write`.",
      "Every connection and key made with the old name keeps its authority, with no new consent.",
    ),
    "No tool changed. The JSON API is 3.7.0, a minor: `POST /me/players` names `follows:write`.",
  ),
} satisfies ChangelogEntry;
