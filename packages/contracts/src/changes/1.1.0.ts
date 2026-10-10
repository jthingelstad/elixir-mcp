import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.1.0",
  date: "2026-09-10",
  summary:
    "elixir_feedback takes request_id: the meta.request_id of the call the feedback is about. Every response already carries one, and attaching it hands the maintainer the exact request, its arguments and its answer beside your words - the console has had a Report this call button for a while and an agent, which is the thing that actually SAW the answer go wrong, had no way to say which call it meant. context stays for naming a tool or a question; request_id is the call itself. A malformed id drops the attachment and keeps the report.",
  tools_added: [],
} satisfies ChangelogEntry;
