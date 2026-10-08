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
import { validateArgs } from "../../packages/tools/src/validate.mjs";

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
    id: "clans-context-ungranted",
    tools: ["clans_context"],
    run: async (ctx) => {
      const r = await ctx.read("clans_context", {});
      ok(
        r.isError === true && r.body?.error?.code === "not_entitled",
        "The acceptance agent has no private-context grant; game scope cannot authorize policy reads.",
      );
      ok(!r.body?.context, "Refusal exposes no private context.");
      return { ms: r.ms };
    },
  },
  {
    id: "timeline-canonical-evidence",
    tools: ["elixir_timeline"],
    run: async (ctx) => {
      const sourceArgs = {
        days: 1,
        mark_read: false,
        kinds: ["battle_session", "arena_changed", "ranked_promotion"],
        verbosity: "compact",
      };
      let feed = answered(
        await ctx.read("elixir_timeline", sourceArgs),
        "Timeline evidence source",
      );
      let item = feed.timeline.find((x) => x.evidence?.count > 0);
      if (!item) {
        feed = answered(
          await ctx.read("elixir_timeline", { ...sourceArgs, days: 7 }),
          "Timeline evidence source (seven days)",
        );
        item = feed.timeline.find((x) => x.evidence?.count > 0);
      }
      if (!item)
        return {
          skip: "No naturally recorded visible game evidence in the bounded seven-day window; scratch fixtures cover this conditional page.",
        };
      const readEvidence = () =>
        ctx.read("elixir_timeline", {
          from: feed.window.from,
          to: feed.window.to,
          kinds: ["battle_session", "arena_changed", "ranked_promotion"],
          evidence_item_id: item.id,
          expected_evidence_version: item.evidence.version,
          evidence_limit: 25,
        });
      let detail = await readEvidence();
      const changed = (result) =>
        result.isError &&
        result.body?.error?.hint?.reason === "evidence_changed";
      if (changed(detail)) {
        const now = Date.now();
        const fixedArgs = { ...sourceArgs };
        delete fixedArgs.days;
        feed = answered(
          await ctx.read("elixir_timeline", {
            ...fixedArgs,
            from: new Date(now - 7 * 86400000).toISOString(),
            to: new Date(now).toISOString(),
          }),
          "Timeline evidence refresh",
        );
        item = feed.timeline.find((x) => x.evidence?.count > 0);
        if (!item)
          return {
            skip: "Canonical evidence changed and no natural fixture remains in the bounded refresh window.",
          };
        detail = await readEvidence();
        if (changed(detail))
          return {
            skip: "Canonical evidence changed during both bounded reads; supported version conflict, not a frozen fixture.",
          };
      }
      const body = answered(detail, "canonical Timeline evidence");
      eq(body.applied.mark_read, false, "evidence is always read-only");
      eq(body.read_to, feed.read_to, "evidence preserves the pointer");
      eq(body.evidence.version, item.evidence.version, "pinned version");
      ok(body.evidence.battles.length > 0, "canonical references served");
      ok(body.evidence.battles.length <= 25, "bounded first page");
      for (const field of [
        "battle_id",
        "at",
        "type",
        "mode_group",
        "outcome",
        "crowns",
        "trophy_change",
        "short_id",
        "url",
        "relation",
      ])
        everyRowHas(body.evidence.battles, field, "canonical game evidence");
      const schema = ctx.tools.get("elixir_timeline")?.outputSchema;
      // Schema validation runs for this dynamic read, just as it does for
      // catalogue argument sets. No production identities enter the catalogue.
      if (schema) {
        const error = validateArgs(schema, body, "Timeline evidence result");
        ok(!error, `outputSchema: ${error}`);
      }
      return { ms: detail.ms };
    },
  },
  {
    id: "recorder-cards-facts",
    tools: ["cards_card"],
    run: async (ctx) => {
      const r = await ctx.read("cards_card", {
        card_id: 26000007,
        segment: "mine",
      });
      const body = answered(r, "selected card facts");
      notesNameFields(ctx, "cards_card", body);
      eq(body.card.id, 26000007, "card identity");
      for (const form of ["base", "evolution", "hero"])
        ok(
          form in body.card.first_played,
          "first_played says unknown forms too",
        );
      for (const field of ["season", "history", "partners", "prior", "decks"])
        ok(!(field in body), `retired card statistic ${field}`);
      if (body.applied.segment.kind === "clan") {
        everyRowHas(body.members.played, "level_played", "member play");
        everyRowHas(body.members.held, "observed_at", "member inventory");
      }
      return { ms: r.ms };
    },
  },
  {
    id: "recorder-retired-refusals",
    tools: ["cards_card"],
    run: async (ctx) => {
      for (const tool of [
        "rankings_players",
        "rankings_clans",
        "rankings_clan_ladder",
        "rankings_timeline",
        "battles_meta_decks",
        "battles_meta_cards",
        "cards_synergy",
        "battles_deck_sets",
        "battles_deck_upgrades",
      ]) {
        ok(!ctx.tools.has(tool), `${tool} is absent from tools/list`);
        const r = await ctx.call(tool, {});
        ok(r.isError, `${tool} refuses a stale declaration`);
        eq(r.body?.error?.code, "rpc_error", `${tool} refusal`);
        ok(
          r.body?.error?.message?.includes(`Unknown tool: ${tool}`),
          `${tool} is a named protocol refusal`,
        );
      }
      const r = await ctx.call("cards_card", {
        card_id: 26000007,
        segment: "corpus",
      });
      ok(r.isError, "corpus selector refuses");
      eq(r.body?.error?.code, "bad_request", "corpus refusal");
    },
  },

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
      everyRowHas(body.standings, "clan_war_trophies", "standings");
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
        "clan_war_trophies",
      ])
        everyRowHas(body.rivals, k, "rivals");
      return { ms: r.ms };
    },
  },
  {
    id: "clans_participation",
    run: async (ctx) => {
      const r = await ctx.read("clans_participation", { weeks: 2 });
      answered(r, "clans_participation");
      // The notes name what the agent was sent: the table (#124), whose
      // rows are arrays named by columns and decode to the objects.
      const raw = r.raw ?? r.body;
      notesNameFields(ctx, "clans_participation", raw);
      for (const key of ["members", "former_members"]) {
        const cols = raw.columns?.[key];
        ok(Array.isArray(cols), `clans_participation: columns.${key} missing`);
        const bad = raw[key].filter(
          (row) => !Array.isArray(row) || row.length !== cols.length,
        ).length;
        ok(
          bad === 0,
          `clans_participation: ${bad} ${key} rows are not ${cols.length}-entry arrays`,
        );
      }
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
