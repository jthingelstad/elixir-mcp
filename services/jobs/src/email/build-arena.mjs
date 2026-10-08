/** arena_week: the recipient's own battles for the game week, primary
 *  and alts, from battles_performance / battles_decks /
 *  battles_opponents. Skipped when no tag of theirs battled. The board
 *  (EmailArena, 2026-10-01) draws one record per mode, the week's main
 *  deck with its art, who you met more than once, and your other
 *  players' climbs; each comes from a tool's own answer. */
import { accountCtx, callTool } from "./ctx.mjs";
import { MODE_GROUPS } from "@elixir-mcp/contracts";
import { buildPlayerEntry } from "@elixir-mcp/tools/activity/entries";
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
      by_family: byFamily(aw),
      trophies:
        ae.trophies?.from != null && ae.trophies?.to != null
          ? { from: ae.trophies.from, to: ae.trophies.to }
          : null,
      modes: groupModes(am),
    });
  }
  if ((!w || !w.battles) && altRows.length === 0) return null;

  const featuredMode = arenaMode(w);
  const decks = featuredMode
    ? await tryTool(callTool, ctx, "battles_decks", {
        player_tag: primary.tag,
        ...window,
        mode: featuredMode,
        sort: "battles",
        limit: 1,
      })
    : null;
  // The most-used deck in the busiest non-war mode. The reader resolves
  // equal deck counts by hash; both reads keep this mode and game week.
  const top = decks?.decks?.[0];
  const topDeck = top
    ? await tryTool(callTool, ctx, "battles_decks", {
        player_tag: primary.tag,
        ...window,
        mode: featuredMode,
        deck_hash: top.deck_hash,
      })
    : null;
  // Every opponent of the week, busiest first: the count and who came
  // round more than once.
  const opps = w?.battles
    ? await tryTool(callTool, ctx, "battles_opponents", {
        player_tag: primary.tag,
        ...window,
        limit: 200,
        sort: "battles",
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
        by_family: byFamily(w),
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
        cards: deckCardLabels(d),
        mode: modeLabel(d.dominant_mode ?? "", ""),
        battles: d.battles,
        wins: d.wins,
        losses: d.losses,
        level_gap: d.mean_level_gap ?? null,
      })),
      deck: arenaFeaturedDeck(featuredMode, topDeck?.decks?.[0]),
      opponents: {
        distinct: opps?.distinct_opponents ?? 0,
        repeats: (opps?.opponents ?? []).filter((o) => o.battles > 1).length,
        // Who came round more than once this week, with the record
        // between you; "new to you" would need more than the week.
        again: (opps?.opponents ?? [])
          .filter((o) => o.battles > 1)
          .slice(0, 3)
          .map((o) => ({
            tag: o.player_tag,
            name: o.name_known ? o.name : o.player_tag,
            battles: o.battles,
            wins: o.wins,
            losses: o.losses,
            mode: modeLabel(o.modes?.[0] ?? "", ""),
          })),
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
      coverage: `${w?.battles ?? 0} battles recorded for ${primary.name}; battle log last read ${agoText(freshness)}. The log holds roughly the last 30 battles, so a long session between reads can leave a gap; missing coverage is unknown, not evidence of absence.`,
    },
    alts: altRows,
  };
}

/** A positive known mode counter chooses the busiest non-war family.
 * Equal counts use the contract's stable mode order, not object order. */
export function arenaMode(window) {
  let best = null;
  let most = 0;
  for (const mode of MODE_GROUPS) {
    if (mode === "war") continue;
    const battles = window?.modes?.[mode]?.battles;
    if (Number.isSafeInteger(battles) && battles > most) {
      best = mode;
      most = battles;
    }
  }
  return best;
}

/** Art and every statistic come from the same mode-filtered full read.
 * Missing or mixed mode evidence cannot become a mode-labelled card. */
export function arenaFeaturedDeck(mode, full) {
  if (!mode || full?.dominant_mode !== mode) return null;
  const modes = Object.keys(full.modes ?? {});
  if (modes.length !== 1 || modes[0] !== mode) return null;
  return featuredDeck(full, full);
}

/** The record per mode family, from battles_performance's own split. */
function byFamily(w) {
  return Object.entries(w?.modes ?? {})
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
    .sort((a, b) => b.battles - a.battles);
}

/** The deck the mail draws: the list row's record and the full read's
 *  cards (id, name, form) and tower troop, which the mail prints as
 *  text. Null when the full read is missing: no art is better than art
 *  guessed from names. */
export function featuredDeck(row, full) {
  if (!row || !Array.isArray(full?.cards) || full.cards.length === 0)
    return null;
  return {
    family: row.dominant_mode,
    label: full.archetype_label ?? row.archetype_label ?? null,
    battles: row.battles,
    wins: row.wins,
    losses: row.losses,
    cards: full.cards.map((c) => ({
      id: c.id,
      name: c.name,
      form: c.form ?? "base",
    })),
    tower_troop: full.tower_troop?.name ?? full.tower_troop_name ?? null,
    average_elixir: full.archetype?.average_elixir ?? null,
    level_gap: row.mean_level_gap ?? null,
  };
}

/** A battles_decks list row deliberately carries card_names, not the full
 * card objects. The mail asks for a list, so preserve that compact shape. */
export function deckCardLabels(deck) {
  if (Array.isArray(deck.cards)) return deck.cards.map(cardLabel);
  return typeof deck.card_names === "string" ? deck.card_names.split(", ") : [];
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
