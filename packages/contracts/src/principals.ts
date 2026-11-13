/**
 * What each kind of principal may see and call.
 *
 * The point is not secrecy — reads are universal and roles never gate
 * visibility. The point is that a connector's tool surface should describe the
 * job it is for, because a leader may hold a personal connection AND an agent
 * connection in the same Claude session. If both publish identical tool lists,
 * the model picks between them arbitrarily and the two give different answers
 * from different subjects, silently. Making the surfaces differ turns that into
 * a visible choice.
 *
 * Hiding is not enforcement: clients cache tools/list aggressively, so the
 * server refuses a hidden tool as well as omitting it.
 */

export type PrincipalKind = "person" | "agent";

/**
 * Tools that assume a person.
 *
 * `elixir_my_players` is the sharpest: its answer is "the players YOU added",
 * which for an agent means its owner's personal claimed-player list. That is
 * how a clan Discord bot came to be able to recite Jamie's own tags into a
 * public channel.
 *
 * The two follow tools (named track until 12.0.0) left this list at 7.1.0
 * (Jamie, 2026-09-23: a clan agent may be asked to follow a competitive
 * clan). An agent follows with an agent's meaning: its players are watched,
 * never "me", its clans spend its owner's pooled slots, and it keeps the
 * clan it acts for.
 *
 * `clans_my_view` (11.12.0, #535) is a person's own view of their clan in
 * Clan, for the person's own connection only, never an owned agent
 * (Jamie's ruling on #535, 2026-10-12).
 */
export const PERSON_ONLY_TOOLS: readonly string[] = [
  "elixir_my_players",
  "clans_my_view",
];

/**
 * Withheld from a person's connection: the identity map is an agent's
 * (one connection serving several humans, `on_behalf_of` naming which).
 * A person is themselves, so a personal connection ignores on_behalf_of
 * and has no map to keep (Jamie, 2026-09-25: the identity tools are
 * agent-only).
 */
export const NOT_FOR_PERSONS: readonly string[] = ["elixir_my_identities"];

export function toolsHiddenFrom(kind: string | null | undefined): Set<string> {
  // Unknown or absent kind is a person: every credential issued before the
  // principal kinds is one, and defaulting the other way would silently
  // remove tools from real users. An integration account presents no
  // credential any door takes (JSON API 5.0.0), so it never gets here.
  if (kind === "agent") return new Set(PERSON_ONLY_TOOLS);
  return new Set(NOT_FOR_PERSONS);
}
