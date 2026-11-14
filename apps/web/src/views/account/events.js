/** A change on an account, in the words the page uses. The kinds are the
 *  server's (`account_event`); one nobody named yet reads as its own words. */
const LABELS = {
  signed_in: "Signed in",
  claim_added: "Player added",
  claim_ended: "Player no longer yours",
  claim_verified: "Player verified",
  verify_started: "Verification started",
  clan_added: "Clan added",
  clan_removed: "Clan removed",
  primary_clan_changed: "Clan it acts for changed",
  recording_started: "Recording started",
  recording_stopped: "Recording stopped",
  connection_revoked: "App disconnected",
  connection_scope_changed: "Connection permissions changed",
  agent_created: "Agent created",
  principal_renamed: "Agent renamed",
  principal_scope_changed: "Agent permissions changed",
  principal_token_revoked: "Agent key revoked",
  role_changed: "Limits changed",
  discord_linked: "Discord connected",
  discord_unlinked: "Discord disconnected",
  gateway_raised: "Collector raised",
  gateway_card_picked: "Collector card changed",
  gateway_token_staged: "Collector token staged",
  gateway_config_claimed: "Collector token revealed",
  email_pref: "Email choice changed",
};

const GROUP = {
  signed_in: "signins",
  claim_added: "players",
  claim_ended: "players",
  claim_verified: "players",
  verify_started: "players",
  clan_added: "players",
  clan_removed: "players",
  primary_clan_changed: "players",
  recording_started: "players",
  recording_stopped: "players",
  discord_linked: "discord",
  discord_unlinked: "discord",
};

export const EVENT_GROUPS = [
  { key: "all", label: "Everything" },
  { key: "signins", label: "Sign-ins" },
  { key: "players", label: "Players and clans" },
  { key: "access", label: "Access" },
  { key: "discord", label: "Discord" },
];

const upper = (words) => words.charAt(0).toUpperCase() + words.slice(1);

export const eventLabel = (kind) =>
  LABELS[kind] ?? upper(String(kind ?? "").replaceAll("_", " "));

export const eventGroup = (kind) => GROUP[kind] ?? "access";

/** The subject of a change: a name beside its tag, or the role or name the
 *  event carried. Empty when it carried neither. */
export function eventDetail(e) {
  const d = e.detail ?? {};
  if (e.kind === "email_pref")
    return `${upper(d.label ?? d.kind ?? "")}: ${d.cadence ?? (d.enabled ? "on" : "off")}`;
  const tag = d.player_tag ?? d.clan_tag ?? null;
  if (tag) return d.subject_name ? `${d.subject_name} ${tag}` : tag;
  return d.username ?? d.client_name ?? d.role ?? d.name ?? "";
}
