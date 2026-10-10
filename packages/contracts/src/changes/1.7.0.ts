import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.7.0",
  date: "2026-09-11",
  summary:
    "live: true is asynchronous. It means: answer from a read of the game no older than the API's own cache (60 s for players, battle logs and boards; 120 s for clans and the river race) if one is in hand; otherwise queue one priority fetch and answer NOW from the record with live_status: { state: 'pending', retry_after_s } - call again after that and the fresh view is there. Nothing waits on a collector inside a call any more. A subject with no record at all answers live_pending (NEW error code) with the same retry_after_s. live_fetch, the raw path, answers live_pending until the payload is in hand. A queued live fetch is charged once, when it is minted; the fresh read and the follow-up calls are not. Every collector in the fleet picks up priority work - there is no live channel.",
  tools_added: [],
} satisfies ChangelogEntry;
