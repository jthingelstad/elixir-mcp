/**
 * The control next to the number (feedback #54, #55, #59, #60; 3.13.0).
 *
 * Six cases from one agent session reached a wrong conclusion from
 * correct data, and each time the payload had withheld the fact that
 * made its number interpretable: a deck's win rate without the mode it
 * was played in (war matchmaking hands stronger players weaker
 * opponents, so a war-only deck outshines a ladder deck whatever their
 * quality), a trophy sum without the floor that made losses free, a
 * weekly bucket the window had clipped. These helpers compute those controls so every
 * aggregate can carry them, and the note fires only when a confound is
 * detected: signal, not boilerplate.
 */

import { MODE_GROUP_BY_TYPE } from "@elixir-mcp/contracts";

/** The mode group a battle type folds into; the API's own odd values
 *  ('unknown', 'casual1v1', 'None') are 'other'. */
export function modeGroupOf(type) {
  return MODE_GROUP_BY_TYPE[type] ?? "other";
}

/** Fold per-type counts ({type, battles, wins, losses}) into one object
 *  keyed by mode group: { ladder: {battles, wins, losses}, war: ... }.
 *  Rows may carry `mode_group` instead of `type` (the daily rollup's
 *  grain, daily-sql.mjs), so clans_standings and the meta path share
 *  the fold (3.16.0). */
export function modeSplit(typeRows) {
  const out = {};
  for (const r of typeRows) {
    const g = r.mode_group ?? modeGroupOf(r.type);
    const cur = (out[g] ??= { battles: 0, wins: 0, losses: 0 });
    cur.battles += Number(r.battles ?? 0);
    cur.wins += Number(r.wins ?? 0);
    cur.losses += Number(r.losses ?? 0);
  }
  return out;
}

/**
 * Whether a clan's members' battles are recorded at all (3.16.0). An
 * activity-scope clan records roster and war only, so every battle
 * count for its members is zero by construction, not by play; a
 * comprehensive one records every member's log, and a member of an
 * activity clan may still be recorded directly (a claim, a collection,
 * a board). Returns the clan-level basis and, per member,
 * `log_recorded` and `recorded_since` (the first recorded battle).
 */
export async function coverageBasis(db, clanTag) {
  const {
    rows: [clan],
  } = await db.query(
    `select exists (select 1 from recording
                     where subject_type = 'clan' and subject_tag = $1
                       and status = 'active' and scope = 'comprehensive') as comprehensive`,
    [clanTag],
  );
  const comprehensive = clan?.comprehensive === true;
  const { rows } = await db.query(
    `select cm.player_tag,
            ($2 or exists (select 1 from recording r
                            where r.subject_type = 'player' and r.subject_tag = cm.player_tag
                              and r.status = 'active' and r.scope = 'comprehensive')) as log_recorded,
            (select min(bp.battle_time) from battle_participant bp
              where bp.player_tag = cm.player_tag) as recorded_since
       from clan_membership cm
      where cm.clan_tag = $1 and cm.left_observed_at is null`,
    [clanTag, comprehensive],
  );
  const members = new Map();
  for (const r of rows)
    members.set(r.player_tag, {
      log_recorded: r.log_recorded === true,
      recorded_since: r.recorded_since?.toISOString() ?? null,
    });
  return {
    basis: comprehensive ? "recorded" : "roster_and_war_only",
    members,
  };
}

/** The one sentence an activity-scope clan's counts carry. */
export function coverageBasisNote(basis) {
  if (basis !== "roster_and_war_only") return null;
  return "basis is roster_and_war_only: this clan's recording covers the roster and the war, not its members' battle logs, so every battle count here is zero by construction for a member whose log_recorded is false; read log_recorded before reading a zero.";
}

/** A segment meta read whose returned rows are all one player's decks
 *  is that player's habit, not a meta (3.16.0). Fires only then. */
export function singlePlayerNote(rows, { what = "deck" } = {}) {
  const shown = rows.filter((r) => typeof r.players === "number");
  if (shown.length === 0 || !shown.every((r) => r.players === 1)) return null;
  return `Every ${what} row here was played by ONE player (players: 1): this segment's numbers describe a few players' habits, not a meta; widen the segment or read the corpus for the field.`;
}

/** How many of a rival's observed races were Colosseum weeks, which
 *  score on period points with no finish line and so pool badly with
 *  the fame of a regular week (3.16.0). */
export function colosseumMix(weeks) {
  const total = weeks.length;
  const colosseum = weeks.filter((w) => w.is_colosseum === true).length;
  return { colosseum_races: colosseum, regular_races: total - colosseum };
}

/** A series whose every point reads zero on `field` is an empty field,
 *  not a flat one (3.16.0): rankings_timeline's rated_players. */
export function zeroSeriesNote(points, field) {
  if (points.length === 0) return null;
  if (!points.every((p) => Number(p[field] ?? 0) === 0)) return null;
  return `${field} is 0 at every point in the window: nobody was rated on this board then, so the curve describes an empty field, not a flat one.`;
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
    // + 0 folds a -0 to 0, so a rollup read and a raw read compare equal.
    mean_level_gap:
      g.gapN > 0 ? Number((g.gapSum / g.gapN).toFixed(2)) + 0 : null,
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
  return `Win rates here are NOT comparable across rows: ${parts.join("; ")}; matchmaking differs by mode (war draws opponents from the racing clans, not from your trophies, so a strong player meets weaker ones there) and a level gap moves the expected win rate, so rank ${what}s only within one mode and similar mean_level_gap (pass mode; the record describes the gap and does not adjust for it).`;
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

/**
 * The battle types that move trophies (feedback #61): Trophy Road and
 * Path of Legends are the only ones the API stamps trophyChange on
 * (cr-agent-api-docs players.md). A weekly row's `trophy_battles`
 * counts the ones that REPORTED a delta, and a loss standing on an
 * arena floor reports none, so `trophy_mode_battles` (every battle of
 * these types) is the denominator for "how many ladder games", and the
 * two differ by exactly the floor losses.
 */
export const TROPHY_MODE_TYPES = ["PvP", "pathOfLegend"];

/** Fires when a weekly row holds trophy-mode battles that reported no
 *  delta; names the weeks and the counts so the smaller number is never
 *  read as the games played. */
export function trophyBattlesNote(weeks) {
  const short = weeks.filter(
    (w) =>
      typeof w.trophy_mode_battles === "number" &&
      w.trophy_mode_battles > w.trophy_battles,
  );
  if (short.length === 0) return null;
  const names = short.map((w) => w.iso_week);
  const counts = short.map((w) => w.trophy_mode_battles - w.trophy_battles);
  const list = (xs) =>
    xs.length <= 2
      ? xs.join(" and ")
      : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  return `${short.length === 1 ? "Week" : "Weeks"} ${list(names)} ${short.length === 1 ? "holds" : "hold"} ${list(counts.map(String))} trophy-mode ${counts.every((c) => c === 1) ? "battle" : "battles"} with no reported trophy change (a loss standing on an arena floor reports none): trophy_battles excludes them and is not the count of ladder battles played, so divide by trophy_mode_battles.`;
}
