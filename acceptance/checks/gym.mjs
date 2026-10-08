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
    // The fixed 220.3 future window became present on 2026-10-06.
    // Its captured bite stays; this live control follows the clock.
    id: "220-future-window",
    tools: ["game_events"],
    run: async (ctx) => {
      const from = new Date(Date.now() + 24 * 3600_000).toISOString();
      const to = new Date(Date.parse(from) + 4 * 24 * 3600_000).toISOString();
      const body = await read(ctx, "game_events", { from, to });
      ok(
        body.notes?.some((note) =>
          /not (yet )?(begun|started|read)|future|after (now|the latest)/i.test(
            note,
          ),
        ),
        "a future window explains that it has not been observed yet",
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
      const meta = ctx.tools.get("cards_card");
      ok(
        meta.inputSchema.properties.verbosity.description.startsWith(
          "compact:",
        ),
        "cards_card is two-size",
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
