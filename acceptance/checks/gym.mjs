/** gym: the Elixir Gym's filed repros with their acceptance criteria,
 *  its Pass 2 (regressions) automated. Each case names the feedback id
 *  and asserts the criterion the Gym wrote, on live data, as an
 *  invariant rather than the numbers of the day. A case that overlaps an
 *  identities case points at it instead of repeating it. */

import { readFileSync } from "node:fs";
import { answered, ok, eq, isInt, CLAN } from "../lib.mjs";
import { gymCases } from "../gym-interp.mjs";

/** The Gym's own blocks (gym.json), run as written. */
const filed = gymCases(
  JSON.parse(readFileSync(new URL("../gym.json", import.meta.url), "utf8")),
);

const read = (ctx, tool, args = {}) =>
  ctx
    .read(tool, args)
    .then((r) => answered(r, `${tool} ${JSON.stringify(args)}`));

export const gym = [
  ...filed,
  {
    // #70 (6.4.0): fit_for splits after sort; the unfieldable rows name
    // what is missing. The invariant half is identities/fit_for-split-after-sort.
    id: "70-fit_for",
    run: async (ctx) => {
      const body = await read(ctx, "battles_meta_decks", {
        segment: "corpus",
        mode: "ladder",
        trophy_band: "10000_13999",
        sort: "shrunk_win_rate",
        fit_for: "#20JJJ2CCRU",
        limit: 17,
      });
      ok(isInt(body.fit_for.fielded_battles), "fielded_battles");
      for (const d of body.decks) {
        ok("own_mean_level" in d.fit && "vs_fielded" in d.fit, "fit levels");
        ok(Array.isArray(d.fit.upgrades), "upgrade path");
        ok(
          d.cards.every((c) => "held_level" in c),
          "held_level rides each card",
        );
      }
      ok(
        body.notes.some((n) => /rows are fieldable as held/.test(n)),
        "the fit note counts fieldable-of-top-N",
      );
    },
  },
  {
    // #72 (6.2.0): a window before the recording horizon is unrecorded,
    // not unchanged.
    id: "72-rankings_timeline-horizon",
    run: async (ctx) => {
      const body = await read(ctx, "rankings_timeline", {
        from: "2026-08-03",
        to: "2026-09-07",
      });
      eq(body.applied.window.partial, true, "partial");
      ok("covers" in body.applied.window, "covers echoed");
      ok(
        body.notes.some((n) =>
          /unrecorded for the window, not unchanged/.test(n),
        ),
        "the horizon note",
      );
      ok(body.meta.recorded_since, "meta.recorded_since");
    },
  },
  {
    // #73 (6.2.0): pol_final for a season before the ranked ladder says
    // so, echoes what was asked, and never offers live: true.
    id: "73-pol_final-branches",
    run: async (ctx) => {
      const r = await ctx.read("rankings_players", {
        board: "pol_final",
        season: 87,
        limit: 5,
      });
      const body = r.body;
      const applied = body.applied ?? body.error?.applied ?? {};
      if (!r.isError) {
        eq(applied.season, null, "applied.season null for S87");
        eq(applied.season_requested, 87, "season_requested echoed");
      }
      const text = JSON.stringify(body);
      ok(!/live: true/.test(text), "pol_final never offers live: true");
    },
  },
  {
    // #71/#76 (6.2.0): the live PoL board is the API's top 1,000 and the
    // number is a cutoff, not a floor. Detail: identities/rankings-board-flags-agree.
    id: "71-76-board-depth-and-cutoff",
    run: async (ctx) => {
      const body = await read(ctx, "rankings_players", { limit: 5 });
      ok(body.snapshot.depth <= 1000, "depth is the API's cap or below");
      if (body.snapshot.full)
        ok(
          body.notes.some((n) => /cutoff/.test(n) && /floor_rating/.test(n)),
          "a full board's note says whose cut it is",
        );
    },
  },
  {
    // #74 (6.2.0): verbosity is declared on every published schema.
    id: "74-verbosity-declared-everywhere",
    run: async (ctx) => {
      const missing = [...ctx.tools.values()]
        .filter((t) => !t.inputSchema?.properties?.verbosity)
        .map((t) => t.name);
      eq(missing.length, 0, `tools without verbosity: ${missing.join(", ")}`);
      const meta = ctx.tools.get("battles_meta_decks");
      ok(
        meta.inputSchema.properties.verbosity.description.startsWith(
          "compact:",
        ),
        "battles_meta_decks is two-size (#80)",
      );
    },
  },
  {
    // #81 (6.11.0): finished_early is served, finish_war_day beside it,
    // war_current says the boat finished. Detail: identities/war_history-finish-flags-agree.
    id: "81-finished_early-served",
    run: async (ctx) => {
      const body = await read(ctx, "war_history", {
        clan_tag: CLAN,
        season_id: 135,
        section_index: 3,
      });
      eq(
        body.weeks[0].finished_early,
        true,
        "135/3 finished early (criterion 1)",
      );
      eq(
        body.weeks[0].finish_war_day,
        3,
        "135/3 finished at the close of day 3",
      );
      const colosseum = await read(ctx, "war_history", {
        clan_tag: CLAN,
        season_id: 135,
        section_index: 4,
      });
      eq(colosseum.weeks[0].is_colosseum, true, "135/4 is the Colosseum");
      eq(
        colosseum.weeks[0].finished_early,
        null,
        "Colosseum has no line (criterion 3)",
      );
      const cur = await read(ctx, "war_current", {});
      const finishedNote = cur.notes.some((n) =>
        /boat finished the race/.test(n),
      );
      eq(
        finishedNote,
        cur.race_finished_at !== null,
        "the finished note fires iff the boat has finished (criterion 5)",
      );
    },
  },
  {
    // #82 (6.11.0): finished_races on every rival. Detail: identities/war_rivals-*.
    id: "82-finished_races",
    run: async (ctx) => {
      const body = await read(ctx, "war_rivals", {});
      ok(
        body.rivals.every((r) => isInt(r.finished_races)),
        "finished_races on every row",
      );
      ok(
        body.notes.some((n) => /finished_races is their count/.test(n)),
        "the note names the denominator",
      );
    },
  },
  {
    // #77-#79 (6.12.0): the corpus meta on a week's window answers.
    // Ceilings: budgets/meta-*-corpus-week.
    id: "77-79-corpus-week-answers-from-the-population",
    run: async (ctx) => {
      const body = await read(ctx, "battles_meta_decks", {
        segment: "corpus",
        days: 7,
        limit: 5,
        verbosity: "compact",
      });
      ok(
        body.notes.some((n) => /season population table/.test(n)),
        "read from the population table, cursor named",
      );
      ok(body.decided_battles > 0, "the week has battles");
    },
  },
  {
    // #56/#64: a refusal prices the retry.
    id: "56-64-refusals-name-the-size",
    run: async (ctx) => {
      const r = await ctx.read("elixir_send_feedback", {
        category: "bug",
        message: "x".repeat(8001),
      });
      // The token is cr:read: the refusal is scope or length, and either
      // way it names what to do next rather than failing bare.
      ok(r.isError, "an over-length feedback is refused");
      const said = JSON.stringify(r.body);
      ok(
        /8000|feedback:write/.test(said),
        `the refusal names the limit or the scope it lacks: ${said.slice(0, 160)}`,
      );
    },
  },
];
