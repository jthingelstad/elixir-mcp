/** identities: a number two tools serve agrees; a count's denominator
 *  is on the row; a flag and its detail agree. The Gym's I1 (reconcile
 *  across tools), I4 (a pooled number recoverable from one response)
 *  and I6 (a count says what it counts), as invariants over live data.
 *  Declared in the DSL (dsl.mjs), a line each; the two that need more
 *  than one read per side stay in code at the end. */

import { answered, ok, eq, isInt, JAMIE } from "../lib.mjs";
import {
  same,
  rows,
  scalar,
  ordered,
  implies,
  bounded,
  check,
} from "../dsl.mjs";

const read = (ctx, tool, args = {}) =>
  ctx
    .read(tool, args)
    .then((r) => answered(r, `${tool} ${JSON.stringify(args)}`));

/** The most recent closed regular week in the last three seasons. */
async function closedWeek(ctx) {
  const list = await read(ctx, "war_history", { seasons: 3 });
  const w = list.weeks.find(
    (x) => !x.in_progress && x.finished && !x.is_colosseum,
  );
  ok(w, "a closed regular week in the last three seasons");
  return { season_id: w.season_id, section_index: w.section_index };
}

/** clans_participation's per-member columns align to war_weeks by index:
 *  the running race's column, found from war_current's week (the left
 *  side's body). */
const warDecksThisWeek = (member, body, current) => {
  const i = (body.war_weeks ?? []).findIndex(
    (w) =>
      w.season_id === current?.season_id &&
      w.section_index === current?.section_index,
  );
  return i < 0 ? null : member.war_decks?.[i];
};

export const identities = [
  // --- war: a finish and its detail agree
  implies(
    "a Colosseum week has no finish line",
    "war_history",
    { seasons: 3 },
    "weeks",
    (w) => w.is_colosseum,
    (w) => w.finished_early === null && w.finish_war_day === null,
  ),
  implies(
    "a regular week at the line finished early",
    "war_history",
    { seasons: 3 },
    "weeks",
    (w) =>
      !w.in_progress &&
      !w.is_colosseum &&
      isInt(w.our_fame) &&
      w.our_fame >= 10000,
    (w) => w.finished_early === true,
  ),
  implies(
    "no finish, no finish day",
    "war_history",
    { seasons: 3 },
    "weeks",
    (w) => w.finished_early === false,
    (w) => w.finish_war_day === null,
  ),
  bounded(
    "finish_war_day is a war day",
    "war_history",
    { seasons: 3 },
    "weeks",
    "finish_war_day",
    1,
    4,
  ),
  // scoring_decks and its identities went 2026-09-25 (weekly aggregates
  // only); both counters here are the game's own for the week.
  bounded(
    "boat_attacks within decks_used",
    "war_history",
    closedWeek,
    "member_weeks",
    "boat_attacks",
    0,
    "decks_used",
  ),
  implies(
    "in_progress is on every week row",
    "war_history",
    { seasons: 3 },
    "weeks",
    () => true,
    (w) => typeof w.in_progress === "boolean",
  ),
  // --- war: the day-by-day reconciles through the banked value (#84);
  //     boat decks are inside the deck counts (#85); the horizon rides
  //     the exact-week path (#86)
  check(
    "progress_end_banked is the day's own arithmetic on every day row",
    "war_history",
    closedWeek,
    (body) => {
      let rows = 0;
      for (const d of body.days ?? [])
        for (const s of d.standings) {
          if (!("progress_end_banked" in s))
            return `${s.clan_tag} day ${d.war_day} lacks progress_end_banked`;
          if (
            ![
              s.progress_start,
              s.progress_earned,
              s.progress_from_defenses,
            ].every(isInt)
          )
            continue;
          rows += 1;
          const sum =
            s.progress_start + s.progress_earned + s.progress_from_defenses;
          if (s.progress_end_banked !== sum)
            return `${s.clan_tag} day ${d.war_day}: banked ${s.progress_end_banked}, parts sum ${sum}`;
          if (
            s.progress_end_banked !== s.progress_end &&
            s.progress_end !== 10000
          )
            return `${s.clan_tag} day ${d.war_day}: banked differs from progress_end ${s.progress_end}, which is not the cap`;
          if (
            s.progress_end_banked !== s.progress_end &&
            !body.notes.some((n) => /caps a finished boat/.test(n))
          )
            return `a clamped row with no cap note`;
        }
      return rows === 0 && (body.days ?? []).length > 0
        ? "no day row carried integer parts"
        : null;
    },
  ),
  bounded(
    "boat_attacks within decks_used",
    "war_history",
    closedWeek,
    "member_weeks",
    "boat_attacks",
    0,
    "decks_used",
  ),
  implies(
    "a week with boat decks says they are inside the counts",
    "war_history",
    closedWeek,
    null,
    (body) => (body.member_weeks ?? []).some((m) => m.boat_attacks > 0),
    (body) =>
      body.notes.some((n) =>
        /boat_attacks are counted INSIDE decks_used/.test(n),
      ),
  ),
  implies(
    "history_starts_at rides the exact-week path",
    "war_history",
    closedWeek,
    null,
    () => true,
    (body) =>
      isInt(body.history_starts_at?.season_id) &&
      isInt(body.history_starts_at?.section_index),
  ),

  // --- war: two tools, one number
  same(
    "decks used in the running race",
    rows("war_current", {}, "participants", "player_tag", "decks_used"),
    rows(
      "clans_participation",
      { weeks: 1 },
      "members",
      "player_tag",
      warDecksThisWeek,
    ),
    { allowEmpty: true },
  ),
  same(
    "the clan's size on the roster and in the race",
    scalar("clans_roster", {}, "member_count"),
    scalar("war_current", {}, "member_count"),
  ),
  same(
    "the roster's rows are its member_count",
    scalar("clans_roster", {}, (b) => b.members.length),
    scalar("clans_roster", {}, "member_count"),
  ),

  // --- rivals: denominators on the row
  ordered("a rival's counts nest", "war_rivals", {}, "rivals", [
    "zero_fame_races",
    "finished_races",
    "races_observed",
  ]),
  implies(
    "no finished race, no fame statistic",
    "war_rivals",
    {},
    "rivals",
    (r) => r.finished_races === 0,
    (r) => r.mean_fame === null && r.max_fame === null,
  ),
  implies(
    "a finished race has a mean",
    "war_rivals",
    {},
    "rivals",
    (r) => r.finished_races > 0,
    (r) => isInt(r.mean_fame),
  ),

  // --- a player: one window, two tools
  same(
    "a player's 30-day battles",
    scalar("players_summary", { player_tag: JAMIE }, "last_30_days.battles"),
    scalar(
      "battles_performance",
      { player_tag: JAMIE, days: 30 },
      "window.battles",
    ),
    { tolerance: 2 },
  ),
  same(
    "a player's clan on the profile and the summary",
    scalar("players_profile", { player_tag: JAMIE }, "clan.clan_tag"),
    scalar("players_summary", { player_tag: JAMIE }, "clan.clan_tag"),
  ),

  // --- the two that need more than one read per side
  {
    // 11.6.0: most losses first is an order, never a different answer.
    // Both orders hold the same rows with the same counts (where both
    // lists reach them: each is cut at 120), every row clears the floor,
    // the losses order is losses then battles descending, and every
    // opponent row carries its level gap (a number or null, never absent).
    id: "battles_cards-battles_opponents-losses-order",
    tools: ["battles_cards", "battles_opponents"],
    run: async (ctx) => {
      const args = {
        player_tag: JAMIE,
        perspective: "opponent",
        mode: "ladder",
        days: 90,
      };
      const byBattles = await read(ctx, "battles_cards", args);
      const byLosses = await read(ctx, "battles_cards", {
        ...args,
        sort: "losses",
      });
      eq(byBattles.applied.sort, "battles", "battles_cards default sort");
      eq(byLosses.applied.sort, "losses", "battles_cards sort echoed");
      const floor = byLosses.applied.min_battles;
      ok(isInt(floor) && floor >= 2, `a floor of at least 2 (${floor})`);
      const key = (c) => `${c.id}:${c.form}`;
      const before = new Map(byBattles.cards.map((c) => [key(c), c]));
      for (const [i, c] of byLosses.cards.entries()) {
        ok(c.battles >= floor, `${key(c)}: ${c.battles} under the floor`);
        const prev = byLosses.cards[i - 1];
        if (prev)
          ok(
            prev.losses > c.losses ||
              (prev.losses === c.losses && prev.battles >= c.battles),
            `losses order: ${key(prev)} ${prev.losses}/${prev.battles} before ${key(c)} ${c.losses}/${c.battles}`,
          );
        const same = before.get(key(c));
        if (same) {
          eq(c.losses, same.losses, `${key(c)} losses in both orders`);
          eq(c.battles, same.battles, `${key(c)} battles in both orders`);
        }
      }
      const opp = await read(ctx, "battles_opponents", {
        player_tag: JAMIE,
        days: 90,
        min_battles: 2,
        sort: "losses",
      });
      eq(opp.applied.sort, "losses", "battles_opponents sort echoed");
      for (const [i, o] of opp.opponents.entries()) {
        ok(
          o.mean_level_gap === null || typeof o.mean_level_gap === "number",
          `${o.player_tag}: mean_level_gap ${JSON.stringify(o.mean_level_gap)}`,
        );
        const prev = opp.opponents[i - 1];
        if (prev)
          ok(
            prev.losses >= o.losses,
            `opponents by losses: ${prev.losses} before ${o.losses}`,
          );
      }
    },
  },
  {
    id: "war_rivals-mean-fame-is-the-standings-mean",
    run: async (ctx) => {
      // Pooled over finished shared races: rebuilt from the exact weeks
      // of the current season the rival shared with us (at most five
      // reads); rivals seen in an earlier season are skipped.
      const rivals = await read(ctx, "war_rivals", {});
      const list = await read(ctx, "war_history", { seasons: 1 });
      const weeks = list.weeks.filter((w) => !w.in_progress);
      const fame = new Map();
      for (const w of weeks.slice(0, 5)) {
        const exact = await read(ctx, "war_history", {
          season_id: w.season_id,
          section_index: w.section_index,
        });
        for (const s of exact.standings ?? []) {
          if (!fame.has(s.clan_tag)) fame.set(s.clan_tag, []);
          fame.get(s.clan_tag).push(s.fame);
        }
      }
      let checked = 0;
      for (const r of rivals.rivals) {
        const seen = fame.get(r.clan_tag);
        if (!seen || seen.length !== r.finished_races) continue;
        eq(
          r.mean_fame,
          Math.round(seen.reduce((a, b) => a + b, 0) / seen.length),
          `${r.clan_tag}: mean_fame over ${seen.length} finished weeks`,
        );
        eq(
          r.zero_fame_races,
          seen.filter((f) => f === 0).length,
          `${r.clan_tag}: zero_fame_races`,
        );
        checked += 1;
      }
      ok(checked > 0 || weeks.length === 0, "at least one rival reconciled");
    },
  },
];
