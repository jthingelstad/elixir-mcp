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
  const active = p.recording_status === "active";
  const state = !active
    ? p.recording_status
      ? `Recording ${p.recording_status}`
      : "Recording status unknown"
    : failedAt
      ? "Capture attempt failed"
      : recorded
        ? "Captured data available"
        : "Capture pending";
  const text = !active
    ? recorded
      ? "Your retained record is available. Check recording status in Tracking."
      : "No profile or battles are available yet. Check recording status in Tracking."
    : failedAt
      ? "A recent capture attempt failed. Saved information remains available; check again for new observations."
      : recorded
        ? "Read what has been captured below. Gaps and unobserved time remain unknown."
        : "Your tag is saved. Waiting for the first profile or battle capture; there is no guaranteed arrival time.";
  const profile = {
    action: "View recorded profile",
    to: `${CONSOLE}/explore/profile/${tagPath(p.player_tag)}`,
  };
  const battles = {
    action: "Browse recorded battles",
    to: `${CONSOLE}/explore/list/battles:${tagPath(p.player_tag)}`,
  };
  const destination = hasBattleEvidence(p)
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
    profile: hasBattleEvidence(p) && p.profile_available ? profile : null,
    partial: interval?.ratio != null && interval.ratio < 1 ? interval : null,
  };
}
