import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";
import { CONSOLE } from "./console.js";
import { tagPath } from "./tag-url.js";

/** A saved tag, capture attempts and retained facts are independent evidence.
 * Nothing here treats a successful poll or an empty count as full coverage. */
export function recordJourney(data) {
  const p = data?.player;
  const tracking = `${CONSOLE}/account/tracking`;
  if (!p)
    return {
      state: "Add your player",
      text: "Start with your player tag in Tracking.",
      action: "Go to Tracking",
      to: tracking,
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
        ? "Capture attempt failed"
        : recorded
          ? "Captured data available"
          : "Capture pending";
  const text = !active
    ? recorded
      ? "Your retained record is available. Check recording status in Tracking."
      : "No profile or battles are available yet. Check recording status in Tracking."
    : notFound
      ? `We couldn't find ${p.player_tag} in Clash Royale. Check the tag: in the game it is on the player's profile, below the name. Stop tracking this one and add the right tag.`
      : failedAt
        ? "A recent capture attempt failed. Saved information remains available; check again for new observations."
        : recorded
          ? "Read what has been captured below. Gaps and unobserved time remain unknown."
          : "Your tag is saved. The first capture usually lands within a few minutes, and roughly your last 30 battles arrive with it.";
  const profile = {
    action: "View recorded profile",
    to: `${CONSOLE}/explore/profile/${tagPath(p.player_tag)}`,
  };
  const battles = {
    action: "Browse recorded battles",
    to: `${CONSOLE}/explore/list/battles:${tagPath(p.player_tag)}`,
  };
  const destination = notFound
    ? { action: "Fix the tag", to: `${tracking}/${tagPath(p.player_tag)}` }
    : hasBattleEvidence(p)
      ? battles
      : p.profile_available
        ? profile
        : {
            action: "Check recording status",
            to: `${tracking}/${tagPath(p.player_tag)}`,
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
