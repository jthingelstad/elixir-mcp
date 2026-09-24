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

export type PrincipalKind = "person" | "agent" | "integration";

/**
 * Tools that assume a person.
 *
 * `elixir_my_players` is the sharpest: its answer is "the players YOU added",
 * which for an agent means its owner's personal claimed-player list. That is
 * how a clan Discord bot came to be able to recite Jamie's own tags into a
 * public channel.
 *
 * The two track tools left this list at 7.1.0 (Jamie, 2026-09-23: a clan
 * agent "may be asked to track a competitive clan"). An agent tracks with
 * an agent's meaning: its players are watched, never "me", its clans spend
 * its owner's pooled slots, and it keeps the clan it acts for.
 */
export const PERSON_ONLY_TOOLS: readonly string[] = ["elixir_my_players"];

/**
 * Additionally withheld from integrations, which have no "me" at all.
 *
 * Nicknames are a private naming layer over people you follow; an agent
 * legitimately has one for its clan's members, an integration has nobody.
 * The timeline is built from added subjects, and an integration adds none —
 * it would return an empty window forever, which is worse than absent.
 */
export const AGENT_ONLY_TOOLS: readonly string[] = [
  "elixir_nickname",
  "elixir_timeline",
  // An integration tracks nothing (it adds no subjects; claims refuses it).
  "elixir_track_player",
  "elixir_track_clan",
];

export function toolsHiddenFrom(kind: string | null | undefined): Set<string> {
  // Unknown or absent kind is a person: every credential issued before the
  // three-kind model is one, and defaulting the other way would silently
  // remove tools from real users.
  if (kind === "agent") return new Set(PERSON_ONLY_TOOLS);
  if (kind === "integration")
    return new Set([...PERSON_ONLY_TOOLS, ...AGENT_ONLY_TOOLS]);
  return new Set();
}

export function toolAvailableTo(
  name: string,
  kind: string | null | undefined,
): boolean {
  return !toolsHiddenFrom(kind).has(name);
}
