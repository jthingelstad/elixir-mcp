/** ground: the record against the game itself. The one source the gate
 *  cannot own: two reads of the live Clash Royale API from this machine
 *  (infra/scripts/cr-api.mjs finds the operator key here; the suite
 *  never sends the API's token anywhere and never asks the door for a
 *  live read), compared with what the record serves. Identity facts
 *  must agree; counters the record polls must not be AHEAD of the game,
 *  and must agree when the record is fresh. Skipped, said aloud, where
 *  no key answers (another machine, CI). */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answered, ok, eq, CLAN, JAMIE } from "../lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CR_API = path.join(here, "../../infra/scripts/cr-api.mjs");

/** One live read, or null when no key answers from here. */
function crApi(apiPath) {
  const run = spawnSync(process.execPath, [CR_API, apiPath], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (run.status !== 0) return null;
  try {
    return JSON.parse(run.stdout);
  } catch {
    return null;
  }
}

const FRESH_S = 3 * 3600; // a poll this recent should agree exactly

export const ground = [
  {
    id: "player-profile-agrees-with-the-game",
    run: async (ctx) => {
      const live = crApi(`/players/${JAMIE}`);
      if (!live) return { skip: "no CR API key answers from this machine" };
      const r = await ctx.read("players_profile", { player_tag: JAMIE });
      const body = answered(r, "players_profile");
      eq(body.name, live.name, "name");
      eq(body.clan?.clan_tag, live.clan?.tag, "clan");
      eq(body.attributes?.best_trophies, live.bestTrophies, "best_trophies");
      const fresh = (body.meta?.freshness_seconds ?? Infinity) <= FRESH_S;
      const recorded = body.snapshot?.trophies;
      if (fresh) eq(recorded, live.trophies, "trophies (fresh record)");
      else
        ok(
          Number.isInteger(recorded),
          `trophies recorded (${body.meta?.freshness_seconds}s old: not compared)`,
        );
    },
  },
  {
    id: "war-standings-agree-with-the-game",
    run: async (ctx) => {
      const live = crApi(`/clans/${CLAN}/currentriverrace`);
      if (!live) return { skip: "no CR API key answers from this machine" };
      const r = await ctx.read("war_current", {});
      const body = answered(r, "war_current");
      // Same race: the API's section is the record's.
      eq(body.section_index, live.sectionIndex, "section_index");
      const liveByTag = new Map((live.clans ?? []).map((c) => [c.tag, c]));
      for (const s of body.standings) {
        const g = liveByTag.get(s.participant_clan_tag);
        ok(g, `${s.participant_clan_tag} is in the game's bracket`);
        // Banked fame never runs ahead of the game; equal when the
        // record's race poll is fresh.
        ok(
          s.fame <= g.fame,
          `${g.name}: recorded fame ${s.fame} ahead of the game's ${g.fame}`,
        );
        if ((body.meta?.freshness_seconds ?? Infinity) <= 600)
          eq(s.fame, g.fame, `${g.name}: fame (fresh record)`);
      }
      eq(
        body.standings.length,
        (live.clans ?? []).length,
        "every clan in the bracket",
      );
      // Participants: the game's roster count and ours.
      const liveParticipants = live.clan?.participants?.length ?? null;
      if (liveParticipants !== null)
        ok(
          Math.abs(body.participants_count - liveParticipants) <= 2,
          `participants ${body.participants_count} vs the game's ${liveParticipants}`,
        );
    },
  },
];
