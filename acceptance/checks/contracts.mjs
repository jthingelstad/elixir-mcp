/** contracts: every field a notes[] sentence names exists on the
 *  response it rides. The check is generic (lib.notesNameFields) and the
 *  cases are the surfaces the Gym and the daily agents lean on, each
 *  with the few tokens its notes use as prose. Each case also pins the
 *  fields the docs promise per row, since a note can be right and the
 *  row still empty. */

import {
  answered,
  ok,
  eq,
  everyRowHas,
  notesNameFields,
  CLAN,
  JAMIE,
} from "../lib.mjs";

/** The per-day war fields retired 2026-09-25 (Jamie: weekly aggregates
 *  only; a war day's rollover cannot be placed reliably at scale). */
const DAY_SPLIT = [
  "war_days",
  "war_days_battled",
  "scoring_decks",
  "training_decks",
  "war_scoring_decks",
  "war_decks_by_day",
  "war_battles_by_day",
];
const noDaySplit = (rows, label) => {
  for (const row of rows ?? [])
    for (const f of DAY_SPLIT)
      ok(!(f in row), `${label} carries no ${f} (weekly aggregates only)`);
};

const read = (ctx, tool, args) =>
  ctx
    .read(tool, args)
    .then((r) => answered(r, `${tool} ${JSON.stringify(args)}`));

export const contracts = [
  {
    id: "war_history-seasons",
    run: async (ctx) => {
      const r = await ctx.read("war_history", { seasons: 3 });
      const body = answered(r, "war_history");
      notesNameFields(ctx, "war_history", body, {
        // member rows' fields, named by the notes that describe them
        allow: ["member_weeks", "decks_used"],
      });
      everyRowHas(body.weeks, "finished_early", "war_history.weeks");
      everyRowHas(body.weeks, "finish_war_day", "war_history.weeks");
      everyRowHas(body.weeks, "closed_at", "war_history.weeks");
      ok(body.history_starts_at, "history_starts_at present");
      return { ms: r.ms };
    },
  },
  {
    id: "war_history-exact-week",
    run: async (ctx) => {
      const list = await read(ctx, "war_history", { seasons: 3 });
      const closed = list.weeks.find(
        (w) => !w.in_progress && w.finished && !w.is_colosseum,
      );
      ok(closed, "a closed regular week in the last three seasons");
      const args = {
        season_id: closed.season_id,
        section_index: closed.section_index,
      };
      const r = await ctx.read("war_history", args);
      const body = answered(r, "war_history exact");
      notesNameFields(ctx, "war_history", body);
      everyRowHas(body.member_weeks, "decks_used", "member_weeks");
      noDaySplit(body.member_weeks, "member_weeks");
      everyRowHas(body.standings, "finish_time", "standings");
      ok(Array.isArray(body.days), "days[] on an exact week");
      return { ms: r.ms };
    },
  },
  {
    id: "war_current",
    run: async (ctx) => {
      const r = await ctx.read("war_current", {});
      const body = answered(r, "war_current");
      notesNameFields(ctx, "war_current", body, {
        // days_closed's per-day fields are absent until a war day closes.
        allow: ["points_earned", "end_of_day_rank"],
      });
      ok("race_finished_at" in body, "race_finished_at key");
      ok("finish_war_day" in body, "finish_war_day key");
      ok("decks_today" in body, "decks_today is an answer, null included");
      everyRowHas(body.participants, "decks_used", "participants");
      noDaySplit(body.participants, "participants");
      ok(!("attendance_by_war_day" in body), "no attendance_by_war_day");
      everyRowHas(body.standings, "clan_score", "standings");
      return { ms: r.ms };
    },
  },
  {
    id: "war_rivals",
    run: async (ctx) => {
      const r = await ctx.read("war_rivals", {});
      const body = answered(r, "war_rivals");
      notesNameFields(ctx, "war_rivals", body);
      for (const k of [
        "races_observed",
        "finished_races",
        "mean_fame",
        "zero_fame_races",
        "current_race_fame",
        "clan_score",
      ])
        everyRowHas(body.rivals, k, "rivals");
      return { ms: r.ms };
    },
  },
  {
    id: "clans_participation",
    run: async (ctx) => {
      const r = await ctx.read("clans_participation", { weeks: 2 });
      const body = answered(r, "clans_participation");
      notesNameFields(ctx, "clans_participation", body);
      return { ms: r.ms };
    },
  },
  {
    id: "battles_meta_decks-season",
    run: async (ctx) => {
      const r = await ctx.read("battles_meta_decks", {
        segment: "corpus",
        limit: 5,
      });
      const body = answered(r, "battles_meta_decks");
      notesNameFields(ctx, "battles_meta_decks", body, {
        allow: ["held_level", "own_mean_level", "decks", "unfieldable"],
      });
      everyRowHas(body.decks, "shrunk_win_rate", "decks");
      everyRowHas(body.decks, "archetype", "decks");
      everyRowHas(body.decks, "cards", "decks");
      ok(body.players_as_of, "the season read says its as-of");
      return { ms: r.ms };
    },
  },
  {
    id: "battles_meta_cards-season",
    run: async (ctx) => {
      const r = await ctx.read("battles_meta_cards", {
        segment: "corpus",
        limit: 5,
      });
      const body = answered(r, "battles_meta_cards");
      notesNameFields(ctx, "battles_meta_cards", body, {
        allow: ["held_level", "own_mean_level", "decks", "unfieldable"],
      });
      everyRowHas(body.cards, "form", "cards");
      everyRowHas(body.cards, "shrunk_win_rate", "cards");
      return { ms: r.ms };
    },
  },
  {
    id: "battles_meta_decks-compact",
    run: async (ctx) => {
      const r = await ctx.read("battles_meta_decks", {
        segment: "corpus",
        limit: 5,
        verbosity: "compact",
      });
      const body = answered(r, "battles_meta_decks compact");
      eq(body.applied.verbosity, "compact", "applied.verbosity");
      everyRowHas(body.decks, "card_names", "compact decks");
      everyRowHas(body.decks, "archetype_label", "compact decks");
      ok(!("methodology" in body), "compact drops methodology");
      ok(
        body.notes.every((n) => !/has one size/.test(n)),
        "the meta tools are two-size now",
      );
      return { ms: r.ms };
    },
  },
  {
    id: "rankings_players",
    run: async (ctx) => {
      const r = await ctx.read("rankings_players", { limit: 5 });
      const body = answered(r, "rankings_players");
      notesNameFields(ctx, "rankings_players", body, {
        // the profile's name for the same number
        allow: ["pol_trophies"],
      });
      for (const k of ["depth", "full", "floor_rating", "truncated"])
        ok(k in body.snapshot, `snapshot.${k}`);
      ok(body.meta.recorded_since, "meta.recorded_since");
      return { ms: r.ms };
    },
  },
  {
    id: "players_summary",
    run: async (ctx) => {
      const r = await ctx.read("players_summary", { player_tag: JAMIE });
      const body = answered(r, "players_summary");
      notesNameFields(ctx, "players_summary", body, {
        // a floored loss carries trophy_change null: the note says the
        // game omits the field
        allow: ["trophy_change"],
      });
      return { ms: r.ms };
    },
  },
  {
    id: "clans_roster",
    run: async (ctx) => {
      const r = await ctx.read("clans_roster", { clan_tag: CLAN });
      const body = answered(r, "clans_roster");
      notesNameFields(ctx, "clans_roster", body, {
        // war_current's field, pointed at
        allow: ["members_not_in_race"],
      });
      ok(body.members?.length > 0, "members");
      return { ms: r.ms };
    },
  },
  {
    id: "game_clock",
    run: async (ctx) => {
      const r = await ctx.read("game_clock", {});
      const body = answered(r, "game_clock");
      notesNameFields(ctx, "game_clock", body);
      ok(body.next_war_day_opens_at !== undefined, "next_war_day_opens_at");
      return { ms: r.ms };
    },
  },
  {
    id: "elixir_docs-section",
    run: async (ctx) => {
      const r = await ctx.read("elixir_docs", {
        page: "battles",
        section: "war-weeks-points-and-fame",
      });
      const body = answered(r, "elixir_docs");
      const text = JSON.stringify(body);
      // The docs promise these; the war_history case proves the rows.
      for (const f of ["finished_early", "finish_war_day", "decks_used"])
        ok(text.includes(f), `docs name ${f}`);
      return { ms: r.ms };
    },
  },
];
