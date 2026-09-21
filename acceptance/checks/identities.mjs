/** identities: a number two tools serve agrees; a count's denominator
 *  is on the row; a flag and its detail agree. The Gym's I1 (reconcile
 *  across tools), I4 (a pooled number recoverable from one response)
 *  and I6 (a count says what it counts), as invariants over live data. */

import { answered, ok, eq, isInt, fail } from "../lib.mjs";

const read = (ctx, tool, args = {}) =>
  ctx
    .read(tool, args)
    .then((r) => answered(r, `${tool} ${JSON.stringify(args)}`));

export const identities = [
  {
    id: "war_history-finish-flags-agree",
    run: async (ctx) => {
      const body = await read(ctx, "war_history", { seasons: 3 });
      for (const w of body.weeks) {
        const at = `${w.season_id}/${w.section_index}`;
        if (w.is_colosseum) {
          eq(w.finished_early, null, `${at} Colosseum finished_early`);
          eq(w.finish_war_day, null, `${at} Colosseum finish_war_day`);
          continue;
        }
        if (isInt(w.our_fame) && w.our_fame >= 10000)
          eq(w.finished_early, true, `${at} at ${w.our_fame} fame`);
        if (w.finished_early !== true)
          eq(w.finish_war_day, null, `${at} finish_war_day without a finish`);
        if (w.finish_war_day !== null)
          ok(
            w.finish_war_day >= 1 && w.finish_war_day <= 4,
            `${at} finish_war_day ${w.finish_war_day}`,
          );
      }
    },
  },
  {
    id: "scoring_decks-bounded",
    run: async (ctx) => {
      const list = await read(ctx, "war_history", { seasons: 3 });
      const closed = list.weeks.find(
        (w) => !w.in_progress && w.finished && !w.is_colosseum,
      );
      ok(closed, "a closed regular week");
      const body = await read(ctx, "war_history", {
        season_id: closed.season_id,
        section_index: closed.section_index,
      });
      for (const m of body.member_weeks) {
        if (m.scoring_decks === null) continue;
        ok(
          m.scoring_decks >= 0 && m.scoring_decks <= m.decks_used,
          `${m.player_tag}: scoring_decks ${m.scoring_decks} of decks_used ${m.decks_used}`,
        );
        if (closed.finished_early !== true)
          eq(m.scoring_decks, m.decks_used, `${m.player_tag}: unfinished week`);
      }
    },
  },
  {
    id: "war_current-decks-agree-with-participation",
    run: async (ctx) => {
      const cur = await read(ctx, "war_current", {});
      const part = await read(ctx, "clans_participation", { weeks: 1 });
      // Per-member columns align to the top-level war_weeks by index.
      const idx = (part.war_weeks ?? []).findIndex(
        (w) =>
          w.season_id === cur.season_id &&
          w.section_index === cur.section_index,
      );
      if (idx < 0) return; // between weeks: participation has not seen the new one
      const decks = new Map(
        (part.members ?? []).map((m) => [m.player_tag, m.war_decks?.[idx]]),
      );
      let compared = 0;
      const off = [];
      for (const p of cur.participants) {
        if (!decks.has(p.player_tag)) continue;
        compared += 1;
        if (decks.get(p.player_tag) !== p.decks_used)
          off.push(
            `${p.player_tag} ${p.decks_used} vs ${decks.get(p.player_tag)}`,
          );
      }
      ok(compared > 0, "some member in both reads");
      ok(
        off.length === 0,
        `decks_used disagrees with war_decks: ${off.join(", ")}`,
      );
      for (const p of cur.participants)
        if (p.scoring_decks !== null)
          ok(
            p.scoring_decks <= p.decks_used,
            `${p.player_tag}: scoring_decks over decks_used`,
          );
    },
  },
  {
    id: "war_rivals-denominators",
    run: async (ctx) => {
      const body = await read(ctx, "war_rivals", {});
      for (const r of body.rivals) {
        ok(
          r.zero_fame_races <= r.finished_races &&
            r.finished_races <= r.races_observed,
          `${r.clan_tag}: zero_fame ${r.zero_fame_races} <= finished ${r.finished_races} <= observed ${r.races_observed}`,
        );
        if (r.finished_races === 0)
          eq(r.mean_fame, null, `${r.clan_tag}: unobserved is null, not 0`);
        else ok(isInt(r.mean_fame), `${r.clan_tag}: mean_fame`);
      }
    },
  },
  {
    id: "war_rivals-mean-fame-is-the-standings-mean",
    run: async (ctx) => {
      // Pooled over finished shared races: rebuilt from the exact weeks
      // of the current season the rival shared with us. Rivals seen in
      // an earlier season pool more than this season's weeks; those are
      // skipped (the run reads at most five exact weeks).
      const rivals = await read(ctx, "war_rivals", {});
      const list = await read(ctx, "war_history", { seasons: 1 });
      // Closed weeks: the recorder may not have seen the close of the
      // last one yet (finished null) while the standings are final.
      const weeks = list.weeks.filter((w) => !w.in_progress);
      const fame = new Map(); // rival -> [fame per finished shared week]
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
        const mean = Math.round(seen.reduce((a, b) => a + b, 0) / seen.length);
        eq(
          r.mean_fame,
          mean,
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
  {
    id: "meta-excluded-identity",
    run: async (ctx) => {
      for (const tool of ["battles_meta_decks", "battles_meta_cards"]) {
        const body = await read(ctx, tool, { segment: "corpus", limit: 5 });
        const e = body.excluded;
        const sum =
          e.duels +
          e.boat +
          e.draws +
          e.unresolved +
          e.no_deck +
          body.decided_battles;
        eq(e.considered, sum, `${tool}: considered = exclusions + decided`);
        const rows = body.decks ?? body.cards;
        for (const r of rows)
          eq(r.wins + r.losses, r.battles, `${tool}: a row's record sums`);
        if (body.decks) {
          const share = body.decks.reduce((a, r) => a + r.usage_share, 0);
          ok(share <= 1.001, `${tool}: usage_share sums to ${share}`);
        }
        const withheld = body.insufficient_sample === true;
        for (const r of rows)
          eq(
            "shrunk_win_rate" in r,
            !withheld,
            `${tool}: shrunk_win_rate present iff the sample is sufficient`,
          );
      }
    },
  },
  {
    id: "rankings-board-flags-agree",
    run: async (ctx) => {
      const body = await read(ctx, "rankings_players", { limit: 5 });
      const s = body.snapshot;
      if (s.full === true)
        eq(s.truncated, false, "a full board is not truncated");
      ok(isInt(s.depth) && s.depth > 0, "depth");
      if (s.full) ok(isInt(s.floor_rating), "a full board has a floor_rating");
    },
  },
  {
    id: "fit_for-split-after-sort",
    run: async (ctx) => {
      const body = await read(ctx, "battles_meta_decks", {
        segment: "corpus",
        mode: "ladder",
        trophy_band: "11000_13000",
        sort: "shrunk_win_rate",
        fit_for: "#20JJJ2CCRU",
        limit: 17,
      });
      ok(body.fit_for?.plays, "fit_for.plays");
      for (const k of ["families", "win_conditions", "archetypes"])
        ok(Array.isArray(body.fit_for.plays[k]), `plays.${k}`);
      for (const d of body.decks) {
        eq(
          d.fit.fieldable,
          true,
          `${d.deck_hash.slice(0, 8)} in decks[] is fieldable`,
        );
        for (const k of [
          "plays_family",
          "plays_win_condition",
          "plays_archetype",
        ])
          ok(typeof d.fit[k] === "boolean", `fit.${k} boolean`);
        if (d.fit.plays_archetype)
          ok(
            d.fit.plays_win_condition && d.fit.plays_family,
            "the exact shape implies both",
          );
      }
      for (const d of body.unfieldable) {
        eq(d.fit.fieldable, false, "unfieldable rows are not fieldable");
        ok(d.fit.missing.length > 0, "unfieldable names what is missing");
      }
      // The split is after sort and limit: each list keeps the sort, and
      // together they are the top N (limit), not N fieldable plus more.
      const rate = (d) => d.shrunk_win_rate ?? d.win_rate;
      for (const [name, rows] of [
        ["decks", body.decks],
        ["unfieldable", body.unfieldable],
      ])
        for (let i = 1; i < rows.length; i += 1)
          if (rate(rows[i]) > rate(rows[i - 1]))
            fail(`${name}[] is not in the sort order at row ${i}`);
      ok(
        body.decks.length + body.unfieldable.length <= body.applied.limit,
        "the two lists are the top N split, not N fieldable plus more",
      );
    },
  },
];
