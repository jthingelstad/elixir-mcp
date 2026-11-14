import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";
import { playerHref } from "./player.js";
import { SETTINGS } from "./settings.js";
import { tagPath } from "./tag-url.js";

/** The player's own battle log has been read: the freshness every page shows
 * as "Battle log read ...". A battle on record is not that: a tag Elixir
 * already knew as an opponent carries battles from someone else's log, and
 * their profile can land first, so neither ends the first read (2026-11-09). */
export const logRead = (p) => Boolean(p?.battlelog_observed_at);

/** A saved tag, capture attempts and retained facts are independent evidence.
 * Nothing here treats a successful poll or an empty count as full coverage. */
export function recordJourney(data) {
  const p = data?.player;
  const players = `${SETTINGS}/players`;
  if (!p)
    return {
      state: "Add your player",
      text: "Start with your player tag in Players & following.",
      action: "Go to Players & following",
      to: players,
    };
  const recorded = p.profile_available || hasBattleEvidence(p);
  const failures = (p.capture_attempts ?? []).filter(
    (a) =>
      a.last_failed_at &&
      Date.parse(a.last_failed_at) <=
        Date.parse(data.as_of ?? new Date().toISOString()) &&
      (!a.last_admitted_at ||
        Date.parse(a.last_failed_at) > Date.parse(a.last_admitted_at)),
  );
  const failedAt = failures
    .map((a) => a.last_failed_at)
    .sort()
    .at(-1);
  // A failed fetch is not proof of a bad tag, except the one answer the
  // game gives for it: a 404 on the profile is "Player not found"
  // (cr-agent-api-docs players.md). Only before anything was captured:
  // a tag with a record plainly existed.
  const notFound =
    !recorded &&
    failures.some(
      (a) => a.endpoint === "player" && Number(a.last_failed_status) === 404,
    );
  const active = p.recording_status === "active";
  const state = !active
    ? p.recording_status
      ? `Recording ${p.recording_status}`
      : "Recording status unknown"
    : notFound
      ? "Tag not found"
      : failedAt
        ? "The last read failed"
        : recorded
          ? "Recorded and ready to read"
          : "First read pending";
  const text = !active
    ? recorded
      ? "Your retained record is available. Check recording status in Players & following."
      : "No profile or battles are available yet. Check recording status in Players & following."
    : notFound
      ? `We couldn't find ${p.player_tag} in Clash Royale. Correct the tag, or stop following it.`
      : failedAt
        ? "A recent read failed. What was saved is still here; check again for anything new."
        : recorded
          ? "Read what has been recorded below. Gaps, and any time Elixir did not read, stay unknown."
          : "Your tag is saved. Your profile and about your last 30 battles usually show up within a minute (a few at busy times).";
  const profile = {
    action: "View recorded profile",
    to: `${playerHref(p.player_tag)}?tab=record`,
  };
  const battles = {
    action: "Open the player page",
    to: playerHref(p.player_tag),
  };
  const destination = notFound
    ? { action: "Fix the tag", to: `${players}/${tagPath(p.player_tag)}` }
    : hasBattleEvidence(p)
      ? battles
      : p.profile_available
        ? profile
        : {
            action: "Check recording status",
            to: `${players}/${tagPath(p.player_tag)}`,
          };
  const interval = p.capture_interval;
  return {
    state,
    text,
    ...destination,
    failedAt,
    notFound,
    profile: hasBattleEvidence(p) && p.profile_available ? profile : null,
    partial: interval?.ratio != null && interval.ratio < 1 ? interval : null,
  };
}
