/** The words Clan's pages share, so one week reads one way everywhere. */
import { monthDayAt, noun } from "@elixir-mcp/ui";

export const ROLE = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};

/** A count, with a dash for what the record does not hold: a gap is unknown,
 *  never zero. */
export const n = (x) =>
  x === null || x === undefined ? "—" : x.toLocaleString();

/** Weeks and races turn on UTC boundaries, so their days are read in UTC. */
export const date = (ts) => monthDayAt(ts, "UTC");

export const plural = (k, one, many = `${one}s`) =>
  `${n(k)} ${k === 1 ? one : many}`;

export const ordinal = (k) => {
  const tens = k % 100;
  if (tens >= 11 && tens <= 13) return `${k}th`;
  return `${k}${["th", "st", "nd", "rd"][k % 10] ?? "th"}`;
};

/** A race as the game's week: "Season 137, week 4". `section_index` counts
 *  from zero, the game's own count. */
export const seasonWeek = (w) =>
  w && w.season_id !== null && w.season_id !== undefined
    ? w.section_index !== null && w.section_index !== undefined
      ? `Season ${w.season_id}, week ${w.section_index + 1}`
      : `Season ${w.season_id}`
    : null;

/** The fame a race finished with, and the war trophies it moved. */
export const trophyChange = (r) =>
  r?.trophy_change === null || r?.trophy_change === undefined
    ? null
    : `${r.trophy_change > 0 ? "+" : ""}${n(r.trophy_change)} war ${noun(Math.abs(r.trophy_change), "trophy", "trophies")}`;

/** "finished 2nd in the Colosseum, Season 137, week 4, with 84,200 fame (+20
 *  war trophies)". Null when the record holds no result for the race. */
export function raceSentence(war) {
  const r = war?.result;
  if (!r?.rank) return null;
  const change = trophyChange(r);
  return `finished ${ordinal(r.rank)}${war.is_colosseum ? " in the Colosseum" : ""}, ${seasonWeek(war)}${r.fame !== null && r.fame !== undefined ? `, with ${n(r.fame)} fame` : ""}${change ? ` (${change})` : ""}`;
}

/** Where a race is: the Colosseum, or the river race. */
const raceWhere = (race) =>
  race.is_colosseum ? "the Colosseum" : "the river race";

/** The clan card's race chip (G5): "2nd in the Colosseum · 84,200 fame".
 *  A place only when the read gives one; fame only once some is banked.
 *  Null between races. */
export function raceChip(race) {
  if (!race) return null;
  if (race.day_kind === "training") return "Clan Wars · training days";
  const fame = race.fame > 0 ? `${n(race.fame)} fame` : null;
  const head = race.finished
    ? `Finished ${raceWhere(race)}`
    : race.place
      ? `${ordinal(race.place)} in ${raceWhere(race)}`
      : `In ${raceWhere(race)}`;
  return [head, fame].filter(Boolean).join(" · ");
}
