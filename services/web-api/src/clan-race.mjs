import { shapeRaceNow } from "./routes/home.mjs";

/**
 * The race now, for Clan's clan card and the Feed's race bar (G5,
 * 2026-11-12): the war week as weekly facts, never a day's split
 * (DECISIONS, "War facts are weekly aggregates").
 *
 * - `place` and `fame` are Home's (`shapeRaceNow`): a place only when it
 *   is one.
 * - `clans` is how many boats are in the race.
 * - `decks` is the clan's war decks this race week over four a war day
 *   for each current member up to the finish, the same ask Clan's war
 *   judgments use; only current members count on either side.
 * - `closes_at` is the policy grid's end of the race week; the race
 *   itself closes in the half hour before it, so the page says "about".
 *
 * `{ race: null }` when the clan has no race recorded or it is between
 * races. `invoke` is the in-process tool call, as this member.
 */
export async function readClanRace(invoke, clanTag, now = Date.now()) {
  const r = await invoke("war_current", { clan_tag: clanTag });
  if (r.isError) {
    if (r.body?.error?.code === "not_recorded") return { race: null };
    const err = new Error(r.body?.error?.message ?? "war_current failed");
    err.code = r.body?.error?.code ?? "elixir_unavailable";
    throw err;
  }
  return { race: shapeClanRace(r.body, clanTag, now) };
}

export function shapeClanRace(current, clanTag, now = Date.now()) {
  const race = shapeRaceNow(current, clanTag, now);
  if (!race) return null;
  const period = current.period ?? {};
  const out = {
    ...race,
    clans: (current.standings ?? []).length || null,
    closes_at: period.week_end_nominal ?? null,
    war_day_opens_at: current.next_war_day_opens_at ?? null,
  };
  if (race.day_kind !== "war") return out;
  const members = (current.participants ?? []).filter((p) => p.in_clan);
  const lastDay =
    race.finished && current.finish_war_day != null
      ? current.finish_war_day
      : race.war_day;
  out.decks =
    members.length && lastDay
      ? {
          used: members.reduce((sum, p) => sum + (p.decks_used ?? 0), 0),
          asked: 4 * lastDay * members.length,
        }
      : null;
  return out;
}
