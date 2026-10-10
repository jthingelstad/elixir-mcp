import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.3.0",
  date: "2026-10-08",
  summary: md(
    "Feedback is one system for all of Elixir: what you file over MCP, the JSON API, the Console, Ladder, Elixir Clan, the docs or an email's footer is the same record, answered in one queue, and elixir_my_feedback returns all of it wherever you filed it.",
    list(
      "elixir_send_feedback takes refs (up to 20 pointers: email, player, clan, clan_action, award, policy) beside request_id and request_ids, and follows_id to reply to one of your own answered items. category gains judgment (Elixir judged someone wrongly). Only your own calls and emails attach; a pointer that is malformed or not yours is dropped and named in notes, and the report is kept. Agents may pass on_behalf_of when relaying a person's feedback; the answer still comes to the agent. applied.request_ids now lists every call attached, the named request_id first.",
      "elixir_my_feedback takes area (mcp, api, console, ladder, clan, mail, docs) and each item carries area, and refs and follows_id when it has them.",
    ),
    "Additive. JSON API 3.1.0 adds POST and GET /feedback, mirroring these two tools, for a person's grant with feedback:write and for an integration holding feedback:write.",
  ),
} satisfies ChangelogEntry;
