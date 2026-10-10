import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.1",
  date: "2026-09-27",
  summary: md(
    "`elixir_timeline` shows a clan's leaders-only facts (a member's away) to a leader reading through their own connection; a service key on a person's account reads what the clan shares. The OAuth server gains `POST /oauth/revoke` (RFC 7009), and the consent page names the host a client's codes go to (review §6.5).",
  ),
} satisfies ChangelogEntry;
