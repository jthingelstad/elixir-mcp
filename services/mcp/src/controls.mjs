/**
 * The control next to the number (feedback #54, #55, #59, #60; 3.13.0).
 *
 * Six cases from one agent session reached a wrong conclusion from
 * correct data, and each time the payload had withheld the fact that
 * made its number interpretable: a deck's win rate without the mode it
 * was played in (war matchmaking hands stronger players weaker
 * opponents, so a war-only deck outshines a ladder deck whatever their
 * quality), a pilot-score trend without the arena change under it, a
 * trophy sum without the floor that made losses free, a weekly bucket
 * the window had clipped. These helpers compute those controls so every
 * aggregate can carry them, and the note fires only when a confound is
 * detected: signal, not boilerplate.
 */

import { MODE_GROUP_BY_TYPE } from "@elixir-mcp/contracts";

/** The mode group a battle type folds into; the API's own odd values
 *  ('unknown', 'casual1v1', 'None') are 'other'. */
function modeGroupOf(type) {
  return MODE_GROUP_BY_TYPE[type] ?? "other";
}

/** Fold per-type counts ({type, battles, wins, losses}) into one object
 *  keyed by mode group: { ladder: {battles, wins, losses}, war: ... }. */
export function modeSplit(typeRows) {
  const out = {};
  for (const r of typeRows) {
    const g = modeGroupOf(r.type);
    const cur = (out[g] ??= { battles: 0, wins: 0, losses: 0 });
    cur.battles += r.battles;
    cur.wins += r.wins;
    cur.losses += r.losses;
  }
  return out;
}

/** Battle types to a count per mode group: { ladder: 10, war: 4 }. */
export function countByMode(types) {
  const out = {};
  for (const t of types) out[modeGroupOf(t)] = (out[modeGroupOf(t)] ?? 0) + 1;
  return out;
}

/** Per-type rows ({type, battles, level_battles, mean_level_gap}) folded
 *  to one row per mode group with the mean gap weighted by the battles
 *  that had both levels (null when none did). */
export function modeGaps(typeRows) {
  const pooled = new Map();
  for (const r of typeRows) {
    const mode = modeGroupOf(r.type);
    const cur = pooled.get(mode) ?? { mode, battles: 0, gapSum: 0, gapN: 0 };
    cur.battles += r.battles;
    const n = r.level_battles ?? r.battles;
    if (r.mean_level_gap !== null && r.mean_level_gap !== undefined && n > 0) {
      cur.gapSum += Number(r.mean_level_gap) * n;
      cur.gapN += n;
    }
    pooled.set(mode, cur);
  }
  return [...pooled.values()].map((g) => ({
    mode: g.mode,
    battles: g.battles,
    mean_level_gap: g.gapN > 0 ? Number((g.gapSum / g.gapN).toFixed(2)) : null,
  }));
}

/** The group holding the largest share of a split, with that share. */
export function dominantMode(split) {
  let total = 0;
  let best = null;
  for (const [group, c] of Object.entries(split)) {
    total += c.battles;
    if (!best || c.battles > best.battles) best = { group, battles: c.battles };
  }
  if (!best || total === 0) return null;
  return {
    mode: best.group,
    share: Number((best.battles / total).toFixed(3)),
  };
}

const gapText = (g) =>
  g === null || g === undefined ? "gap unknown" : `gap ${signed(g)}`;
const signed = (n) => `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}`;
/** The first eight hex characters of a deck_hash, how a note names a deck. */
export const shortHash = (hash) =>
  hash ? `${String(hash).slice(0, 8)}…` : "?";

/**
 * The comparability guard for a list of win-rate rows, each carrying
 * `modes` (a split), `mean_level_gap` and a `label`. Fires when two rows
 * were played predominantly in different mode groups, or when their
 * mean level gaps differ by half a level or more; returns null when the
 * rows are comparable. One sentence, naming the rows that clash.
 */
export function comparabilityNote(rows, { what = "deck" } = {}) {
  const shown = rows
    .map((r) => ({
      label: r.label,
      dom: dominantMode(r.modes ?? {}),
      gap: typeof r.mean_level_gap === "number" ? r.mean_level_gap : null,
    }))
    .filter((r) => r.dom);
  if (shown.length < 2) return null;
  let modeClash = null;
  let gapClash = null;
  for (let i = 0; i < shown.length && !(modeClash && gapClash); i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i];
      const b = shown[j];
      if (
        !modeClash &&
        a.dom.mode !== b.dom.mode &&
        a.dom.share >= 0.6 &&
        b.dom.share >= 0.6
      )
        modeClash = [a, b];
      if (
        !gapClash &&
        a.gap !== null &&
        b.gap !== null &&
        Math.abs(a.gap - b.gap) >= 0.5
      )
        gapClash = [a, b];
    }
  }
  if (!modeClash && !gapClash) return null;
  const parts = [];
  if (modeClash) {
    const [a, b] = modeClash;
    parts.push(
      `${what} ${a.label} was played ${Math.round(a.dom.share * 100)}% in ${a.dom.mode} (mean level ${gapText(a.gap)}) and ${what} ${b.label} ${Math.round(b.dom.share * 100)}% in ${b.dom.mode} (${gapText(b.gap)})`,
    );
  } else {
    const [a, b] = gapClash;
    parts.push(
      `${what} ${a.label} faced opponents at mean level ${gapText(a.gap)} and ${what} ${b.label} at ${gapText(b.gap)}`,
    );
  }
  return `Win rates here are NOT comparable across rows: ${parts.join("; ")}; matchmaking differs by mode (war draws opponents from the racing clans, not from your trophies, so a strong player meets weaker ones there) and a level gap moves the expected win rate, so rank ${what}s only within one mode and similar mean_level_gap (pass mode, and read battles_levels for the level-expected rate).`;
}

/**
 * Per-mode shares of a whole window with each group's mean level gap,
 * for a pooled aggregate (battles_cards): the note names the groups
 * that were pooled and their gaps when they differ.
 */
export function pooledModesNote(groups) {
  const shown = groups.filter((g) => g.battles > 0);
  if (shown.length < 2) return null;
  const gaps = shown
    .map((g) => g.mean_level_gap)
    .filter((g) => typeof g === "number");
  const spread = gaps.length >= 2 ? Math.max(...gaps) - Math.min(...gaps) : 0;
  const list = shown
    .sort((a, z) => z.battles - a.battles)
    .map(
      (g) =>
        `${g.mode} ${g.battles} (${g.mean_level_gap === null ? "gap unknown" : `mean level gap ${signed(g.mean_level_gap)}`})`,
    )
    .join(", ");
  if (spread < 0.5)
    return `Pooled across modes: ${list}; pass mode to isolate one.`;
  return `Pooled across modes with different matchmaking: ${list}; a card met mostly in the easier-gap mode inherits that mode's record for reasons unrelated to the card, so pass mode before reading a row as a strength or a nemesis.`;
}

/**
 * The trophy floor a player stood on inside a window, from the ladder
 * battles themselves and the record's arena floors. A Trophy Road arena
 * has a floor its players cannot fall below: a loss ON it comes back
 * with no trophyChange at all and a loss just above it is clamped
 * (cr-agent-api-docs players.md, observed 2026-09-15). The record holds
 * each arena's floor as the lowest trophies any snapshot ever showed in
 * it (0102). Returns null when the window holds no ladder battle.
 */
export async function trophyFloor(db, tag, { from, to }) {
  const params = [tag];
  const where = ["bp.player_tag = $1", "bp.type = 'PvP'"];
  if (from) {
    params.push(from);
    where.push(`bp.battle_time >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`bp.battle_time < $${params.length}`);
  }
  const {
    rows: [l],
  } = await db.query(
    `select count(*)::int as ladder_battles,
            count(*) filter (where bp.outcome = 'loss' and bp.trophy_change is null)::int as on_floor_losses,
            min(bp.starting_trophies) filter (where bp.outcome = 'loss' and bp.trophy_change is null) as floor_from_losses,
            min(bp.starting_trophies + coalesce(bp.trophy_change, 0)) as lowest,
            max(bp.starting_trophies + coalesce(bp.trophy_change, 0)) as highest,
            (array_agg(b.arena order by bp.battle_time desc))[1] as last_arena,
            (array_agg(b.arena_id order by bp.battle_time desc))[1] as last_arena_id
     from battle_participant bp join battle b on b.battle_id = bp.battle_id
     where ${where.join(" and ")}`,
    params,
  );
  if (!l || l.ladder_battles === 0) return null;
  // The arena's floor from the snapshots: by id when the battle carries
  // one, else by the name every battle row has carried since 0001.
  let arena = null;
  let snapshotFloor = null;
  if (l.last_arena_id !== null || l.last_arena !== null) {
    const {
      rows: [a],
    } = await db.query(
      `select a.arena_id, a.name,
              (select min(s.trophies) from player_snapshot_daily s
                where s.arena_id = a.arena_id and s.trophies is not null) as floor
       from arena a
       where ($1::int is not null and a.arena_id = $1) or ($1::int is null and a.name = $2)
       limit 1`,
      [l.last_arena_id, l.last_arena],
    );
    if (a) {
      arena = { id: a.arena_id, name: a.name };
      snapshotFloor = a.floor === null ? null : Number(a.floor);
    }
  }
  const fromLosses =
    l.floor_from_losses === null ? null : Number(l.floor_from_losses);
  const candidates = [fromLosses, snapshotFloor].filter(
    (f) => typeof f === "number",
  );
  if (candidates.length === 0) return null;
  const floor = Math.min(...candidates);
  const {
    rows: [c],
  } = await db.query(
    `select count(*) filter (where bp.outcome = 'loss' and bp.trophy_change is not null
                              and bp.starting_trophies + bp.trophy_change = $${params.length + 1})::int as landing
     from battle_participant bp
     where ${where.join(" and ")}`,
    [...params, floor],
  );
  const touches = l.on_floor_losses + c.landing;
  return {
    floor,
    arena,
    source: fromLosses !== null ? "losses_on_floor" : "arena_snapshots",
    floored: touches > 0,
    on_floor_losses: l.on_floor_losses,
    losses_landing_on_floor: c.landing,
    ladder_battles: l.ladder_battles,
    trophy_range: {
      lowest: Number(l.lowest),
      highest: Number(l.highest),
    },
  };
}

/** The one sentence a floored window carries. */
export function trophyFloorNote(tf) {
  if (!tf?.floored) return null;
  return `This player stood on the ${tf.floor.toLocaleString("en-US")} trophy floor${tf.arena ? ` (${tf.arena.name})` : ""} during the window: ${tf.on_floor_losses} ladder losses ON the floor cost nothing (trophy_change null) and ${tf.losses_landing_on_floor} landed exactly on it (clamped or full), so net_trophies counts wins in full and those losses at zero and tracks how recently the player played more than how well; read trophy_range and win_rate instead.`;
}

/**
 * Mark the weekly buckets a window clips (feedback #60): the first row
 * of a `days:30` series is usually a partial week shaped exactly like
 * the complete ones, and it anchors the trend. `rows` carry `week_of`
 * (the ISO Monday, YYYY-MM-DD, UTC); `from`/`to` are the window's
 * instants (to null = now).
 */
export function markPartialWeeks(rows, { from, to }, now = new Date()) {
  const end = to ?? now;
  const partial = [];
  const out = rows.map((r) => {
    const start = new Date(`${r.week_of}T00:00:00Z`);
    const stop = new Date(start.getTime() + 7 * 86400_000);
    const coversFrom = from && from > start ? from : start;
    const coversTo = end < stop ? end : stop;
    const clipped = coversFrom > start || coversTo < stop;
    if (!clipped) return r;
    partial.push(r.iso_week);
    return {
      ...r,
      partial: true,
      covers: { from: coversFrom.toISOString(), to: coversTo.toISOString() },
    };
  });
  return { rows: out, partial };
}

export function partialWeeksNote(partial) {
  if (partial.length === 0) return null;
  return `${partial.length === 1 ? "Bucket" : "Buckets"} ${partial.join(", ")} ${partial.length === 1 ? "is" : "are"} partial: the window clips ${partial.length === 1 ? "it" : "them"} (covers says the span each row holds), so compare ${partial.length === 1 ? "it" : "them"} by win_rate, never by battles, or snap from/to to Mondays.`;
}
