/** arena_week: the recipient's own battles for the game week, primary
 *  and alts, from battles_performance / battles_decks /
 *  battles_opponents. Skipped when no tag of theirs battled. */
import { accountCtx, callTool } from "./ctx.mjs";
import { buildPlayerEntry } from "../../../mcp/src/activity/entries.mjs";
import {
  modeLabel,
  cardLabel,
  myPlayers,
  tryTool,
  weekday,
  agoText,
} from "./shared.mjs";

export async function buildArena({ db, account, week, season }) {
  const ctx = accountCtx(db, account);
  const players = await myPlayers(db, account.accountId);
  const primary = players.find((p) => p.relationship === "primary");
  if (!primary) return null;
  const alts = players.filter((p) => p.relationship === "alt");
  const window = { from: week.from.toISOString(), to: week.to.toISOString() };
  const fromMs = week.from.getTime();
  const toMs = week.to.getTime();

  const perf = await tryTool(callTool, ctx, "battles_performance", {
    player_tag: primary.tag,
    ...window,
  });
  const byMode = await tryTool(callTool, ctx, "battles_performance", {
    player_tag: primary.tag,
    ...window,
    group_by: "game_mode",
  });
  const w = perf?.window ?? null;
  const altRows = [];
  for (const a of alts) {
    const ap = await tryTool(callTool, ctx, "battles_performance", {
      player_tag: a.tag,
      ...window,
    });
    const am = await tryTool(callTool, ctx, "battles_performance", {
      player_tag: a.tag,
      ...window,
      group_by: "game_mode",
    });
    const aw = ap?.window;
    if (!aw || !aw.battles) continue;
    const { entry: ae } = await buildPlayerEntry(db, {
      tag: a.tag,
      relationship: "alt",
      fromMs,
      toMs,
      timezone: account.timezone,
    });
    altRows.push({
      tag: a.tag,
      name: a.name,
      battles: aw.battles,
      wins: aw.wins,
      losses: aw.losses,
      sessions: ae.battles.sessions,
      modes: groupModes(am),
    });
  }
  if ((!w || !w.battles) && altRows.length === 0) return null;

  const decks = w?.battles
    ? await tryTool(callTool, ctx, "battles_decks", {
        player_tag: primary.tag,
        ...window,
        limit: 4,
      })
    : null;
  const opps = w?.battles
    ? await tryTool(callTool, ctx, "battles_opponents", {
        player_tag: primary.tag,
        ...window,
        limit: 12,
        sort: "last_seen",
      })
    : null;
  // The timeline's own entry for the primary: sessions (the 30-minute
  // rule) and the trophy line, computed once, the same way the feed says them.
  const { entry } = await buildPlayerEntry(db, {
    tag: primary.tag,
    relationship: "primary",
    fromMs,
    toMs,
    timezone: account.timezone,
  });
  const trophies =
    entry.trophies?.from != null && entry.trophies?.to != null
      ? { from: entry.trophies.from, to: entry.trophies.to }
      : null;
  const floor = perf?.trophy_floor;
  const freshness =
    perf?.meta?.source_polls?.player_battlelog?.freshness_seconds;

  return {
    week: { label: week.label, key: week.key, season },
    primary: {
      tag: primary.tag,
      name: primary.name,
      totals: {
        battles: w?.battles ?? 0,
        wins: w?.wins ?? 0,
        losses: w?.losses ?? 0,
        win_rate: w?.win_rate ?? null,
        crowns_for: w?.crowns_for ?? 0,
        crowns_against: w?.crowns_against ?? 0,
        three_crown_rate: w?.three_crown_rate ?? null,
        sessions: entry.battles.sessions,
        // The headline record per mode family (Jamie 2026-09-25: modes are
        // different games): battles_performance's own split, busiest first.
        by_family: Object.entries(w?.modes ?? {})
          .map(([mode, m]) => ({
            mode,
            battles: m.battles,
            wins: m.wins,
            losses: m.losses,
            win_rate:
              m.wins + m.losses > 0
                ? Number((m.wins / (m.wins + m.losses)).toFixed(3))
                : null,
          }))
          .filter((m) => m.battles > 0)
          .sort((a, b) => b.battles - a.battles),
      },
      trophies: trophies
        ? {
            ...trophies,
            floored: Boolean(floor?.floored),
            floor: floor?.floor ?? null,
            arena: floor?.arena?.name ?? null,
          }
        : null,
      modes: groupModes(byMode),
      decks: (decks?.decks ?? []).map((d) => ({
        cards: d.cards.map(cardLabel),
        mode: modeLabel(d.dominant_mode ?? "", ""),
        battles: d.battles,
        wins: d.wins,
        losses: d.losses,
        level_gap: d.mean_level_gap ?? null,
      })),
      opponents: {
        distinct: opps?.distinct_opponents ?? 0,
        repeats: (opps?.opponents ?? []).filter((o) => o.battles > 1).length,
        rows: (opps?.opponents ?? []).slice(0, 12).map((o) => ({
          tag: o.player_tag,
          name: o.name_known ? o.name : o.player_tag,
          mode: modeLabel(o.modes?.[0] ?? "", ""),
          result:
            o.battles > 1
              ? `${o.wins}–${o.losses}`
              : o.wins
                ? "W"
                : o.losses
                  ? "L"
                  : "D",
          when: weekday(o.last_seen, account.timezone),
        })),
      },
      coverage: `${w?.battles ?? 0} battles recorded for ${primary.name}; battle log last read ${agoText(freshness)}. The log holds 25 battles, so a long session between reads can leave a gap; missing coverage is unknown, not evidence of absence.`,
    },
    alts: altRows,
  };
}

function groupModes(byMode) {
  const out = new Map();
  for (const r of byMode?.by_mode ?? []) {
    const label = modeLabel(r.game_mode, r.type);
    const cur = out.get(label) ?? { label, battles: 0, wins: 0, losses: 0 };
    cur.battles += r.battles;
    cur.wins += r.wins;
    cur.losses += r.losses;
    out.set(label, cur);
  }
  return [...out.values()].sort((a, b) => b.battles - a.battles);
}
