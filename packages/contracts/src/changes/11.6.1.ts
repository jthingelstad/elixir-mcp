import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.6.1",
  date: "2026-10-08",
  summary: md(
    'A river race still matchmaking is no race yet, never an error. For a minute or two after a season roll the game has created a clan\'s new race but not drawn its bracket, so the race has no clans. A live read that landed then failed with live_unavailable ("a payload our admission rejected").',
    list(
      'war_current: with live: true, live_status is { state: "matchmaking", fetched_at, retry_after_s } and a note says no race yet; the rest of the answer is the last race recorded. A clan with no race recorded answers live_pending with retry_after_s. Without live: true the same note rides while the clan\'s latest race read is that one.',
      'live_fetch: /clans/{tag}/currentriverrace serves the API\'s own body (state "matchmaking", no clan) with live_status matchmaking and a note.',
      "Nothing is written for that race, the clan is read again on its usual race cadence, the collector is never charged, and no race or war day counts as missed.",
    ),
    "A correction: no arguments change; live_status gains the state matchmaking. JSON API 3.1.0 is unchanged (its clan live read is /clans/{tag}, never the race).",
  ),
} satisfies ChangelogEntry;
