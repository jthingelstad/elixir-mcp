/**
 * The season rollups as the meta tools read them (0121; schema review
 * 2.1-2.3, plan step 13). A corpus-wide read whose window is exactly one
 * season (the default, or the `season` argument) comes from
 * deck_meta_season / card_meta_season / card_pair_season and
 * meta_season_totals instead of a scan of the participant heap; every
 * other read - a segment, an explicit window - stays on the raw rows,
 * where the covering indexes make it cheap. The rollup path answers the
 * same fields from the same population (the nightly job counts exactly
 * what excludedBreakdown and corpusPrior count; the tools2 test pins the
 * two paths equal), plus `players_as_of` and a completeness note: the
 * counters are hourly and the distinct-player counts nightly.
 */

import { META_METHODOLOGY } from "./tools/shared.mjs";

/** The raw meta scans spill at the micro's 4 MB work_mem (review 2.6:
 *  an external merge over 37k temp blocks). The call's connection is its
 *  own (one client per invocation), so a session SET is per call. */
export async function rawScanMemory(db) {
  await db.query("set work_mem = '32MB'");
}

/** The five trophy bands the meta tools and battles_levels speak (0135):
 *  the participant's own starting trophies at battle time. */
export const TROPHY_BANDS = {
  under_5000: [0, 5000],
  "5000_8000": [5000, 8000],
  "8000_11000": [8000, 11000],
  "11000_13000": [11000, 13000],
  "13000_plus": [13000, null],
};
export const TROPHY_BAND_NAMES = Object.keys(TROPHY_BANDS);

/** The raw-path predicate for a band, appended to a where list. */
export function trophyBandClause(band, params) {
  const [lo, hi] = TROPHY_BANDS[band];
  params.push(lo);
  const clauses = [`bp.starting_trophies >= $${params.length}`];
  if (hi !== null) {
    params.push(hi);
    clauses.push(`bp.starting_trophies < $${params.length}`);
  }
  return clauses.join(" and ");
}

/** The rollup a read can use, or null. `seg.where` non-empty means a
 *  segment; `win.source === "season"` means the row set both bounds.
 *  With `trophyBand` (0135) the band tables answer once the nightly
 *  rebuild has filled them for the season; before that the read returns
 *  `{ pending: true }` and the tool falls back to the raw rows. */
export async function seasonRollup(db, { win, seg, mode, trophyBand = null }) {
  if (seg?.where || win.source !== "season" || !win.season) return null;
  const month = win.season.season_month;
  const {
    rows: [state],
  } = await db.query(
    `select counters_through, rebuilt_at, final, bands_rebuilt_at from meta_season_state
     where season_month = $1 and rebuilt_at is not null`,
    [month],
  );
  if (!state) return null;
  const modeGroup = mode ?? "all";
  if (trophyBand && state.bands_rebuilt_at === null)
    return { pending: true, month, modeGroup };
  const {
    rows: [totals],
  } = await db.query(
    `select considered, duels, boat, draws, unresolved, no_deck, decided, wins, players
     from meta_season_totals where season_month = $1 and mode_group = $2`,
    [month, modeGroup],
  );
  let t = totals ?? {
    considered: 0,
    duels: 0,
    boat: 0,
    draws: 0,
    unresolved: 0,
    no_deck: 0,
    decided: 0,
    wins: 0,
    players: null,
  };
  if (trophyBand) {
    // The band's own decided total and wins; the exclusion categories are
    // the season's (a duel or a boat battle has no band of its own).
    const {
      rows: [band],
    } = await db.query(
      `select decided, wins, players from meta_season_band_totals
       where season_month = $1 and mode_group = $2 and trophy_band = $3`,
      [month, modeGroup, trophyBand],
    );
    t = {
      ...t,
      decided: band?.decided ?? 0,
      wins: band?.wins ?? 0,
      players: band?.players ?? null,
    };
  }
  return {
    month,
    modeGroup,
    trophyBand,
    // The distinct players decided in the season and mode, as of the
    // rebuild (product call 5); null until a rebuild has counted them.
    players: t.players ?? null,
    final: state.final,
    counters_through: state.counters_through.toISOString(),
    players_as_of: state.rebuilt_at.toISOString(),
    excluded: {
      considered: t.considered,
      duels: t.duels,
      boat: t.boat,
      draws: t.draws,
      unresolved: t.unresolved,
      no_deck: t.no_deck,
    },
    prior: {
      decided: t.decided,
      mean:
        t.decided >= META_METHODOLOGY.segment_min_decided
          ? t.wins / t.decided
          : null,
    },
    note: state.final
      ? `Read from the season's final rollup (players_as_of ${state.rebuilt_at.toISOString()}).`
      : `Read from the season rollup: counters through ${state.counters_through.toISOString()}, distinct players as of ${state.rebuilt_at.toISOString()} (a deck or card first seen since then carries players: null until tonight's rebuild).`,
  };
}

/** The corpus prior for a segment-scoped read whose window is one
 *  season: the totals row, or null when no rollup covers it. */
export async function seasonPrior(db, { win, mode }) {
  const roll = await seasonRollup(db, { win, seg: null, mode });
  return roll ? roll.prior : null;
}

/** The mean level gap a rollup row carries (0135), rounded in SQL the
 *  way the raw path rounds it so the two paths agree to the digit; null
 *  until the nightly rebuild has filled the sums. */
const MEAN_GAP_SQL =
  "round((level_gap_sum / nullif(level_gap_battles, 0))::numeric, 2)";
const meanGap = (r) =>
  r.mean_level_gap === null || r.mean_level_gap === undefined
    ? null
    : Number(r.mean_level_gap);

export async function rollupDecks(db, roll, { minBattles }) {
  const banded = roll.trophyBand !== null && roll.trophyBand !== undefined;
  const params = [roll.month, roll.modeGroup, minBattles];
  if (banded) params.push(roll.trophyBand);
  const { rows } = await db.query(
    `select deck_hash, battles, wins, losses, players, first_used, last_used,
            level_gap_battles, ${MEAN_GAP_SQL} as mean_level_gap
     from ${banded ? "deck_meta_season_band" : "deck_meta_season"}
     where season_month = $1 and mode_group = $2 and battles >= $3
       ${banded ? "and trophy_band = $4" : ""}
     order by battles desc`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    mean_level_gap: meanGap(r),
    level_gap_battles: r.level_gap_battles ?? 0,
  }));
}

/** The per-mode-group rows behind the returned decks (0135): the rollup
 *  is keyed by mode group, so a deck's split is one read over its keys. */
export async function rollupDeckModes(db, roll, hashes) {
  if (hashes.length === 0) return new Map();
  const banded = roll.trophyBand !== null && roll.trophyBand !== undefined;
  const params = [roll.month, hashes];
  if (banded) params.push(roll.trophyBand);
  const { rows } = await db.query(
    `select deck_hash, mode_group, battles, wins, losses
     from ${banded ? "deck_meta_season_band" : "deck_meta_season"}
     where season_month = $1 and mode_group <> 'all' and deck_hash = any($2)
       ${banded ? "and trophy_band = $3" : ""}`,
    params,
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.deck_hash)) out.set(r.deck_hash, []);
    out.get(r.deck_hash).push(r);
  }
  return out;
}

export async function rollupCards(db, roll, { minBattles }) {
  const banded = roll.trophyBand !== null && roll.trophyBand !== undefined;
  const params = [roll.month, roll.modeGroup, minBattles];
  if (banded) params.push(roll.trophyBand);
  const { rows } = await db.query(
    `select cm.card_id, c.name, cm.form as evolution,
            cm.battles, cm.wins, cm.losses, cm.players,
            round((cm.level_gap_sum / nullif(cm.level_gap_battles, 0))::numeric, 2) as mean_level_gap
     from ${banded ? "card_meta_season_band" : "card_meta_season"} cm
     join card c on c.card_id = cm.card_id
     where cm.season_month = $1 and cm.mode_group = $2 and cm.form >= 0
       and cm.battles >= $3 ${banded ? "and cm.trophy_band = $4" : ""}`,
    params,
  );
  return rows.map((r) => ({ ...r, mean_level_gap: meanGap(r) }));
}

/** The per-mode-group rows behind the returned cards (0135). */
export async function rollupCardModes(db, roll, keys) {
  if (keys.length === 0) return new Map();
  const banded = roll.trophyBand !== null && roll.trophyBand !== undefined;
  const params = [
    roll.month,
    keys.map((k) => k.card_id),
    keys.map((k) => k.form),
  ];
  if (banded) params.push(roll.trophyBand);
  const { rows } = await db.query(
    `select cm.card_id, cm.form, cm.mode_group, cm.battles, cm.wins, cm.losses
     from ${banded ? "card_meta_season_band" : "card_meta_season"} cm
     join unnest($2::int[], $3::smallint[]) k(card_id, form)
       on k.card_id = cm.card_id and k.form = cm.form
     where cm.season_month = $1 and cm.mode_group <> 'all'
       ${banded ? "and cm.trophy_band = $4" : ""}`,
    params,
  );
  const out = new Map();
  for (const r of rows) {
    const key = `${r.card_id}|${r.form}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return out;
}

/** The season's mode groups with battles and mean gap, for the pooled
 *  note when mode was omitted (the 'all' row pools them). */
export async function rollupModeGroups(db, roll) {
  const banded = roll.trophyBand !== null && roll.trophyBand !== undefined;
  const params = [roll.month];
  if (banded) params.push(roll.trophyBand);
  const { rows } = await db.query(
    `select mode_group as mode, sum(battles)::int as battles,
            round((sum(level_gap_sum) / nullif(sum(level_gap_battles), 0))::numeric, 2) as mean_level_gap
     from ${banded ? "deck_meta_season_band" : "deck_meta_season"}
     where season_month = $1 and mode_group <> 'all' ${banded ? "and trophy_band = $2" : ""}
     group by mode_group`,
    params,
  );
  return rows.map((r) => ({
    mode: r.mode,
    battles: r.battles,
    mean_level_gap: meanGap(r),
  }));
}

/** cards_synergy over a season: the anchor's own row (form -1 = any
 *  form) and every partner's baseline from card_meta_season, the decided
 *  total from the totals; the pairs from the raw rows of the decks that
 *  CONTAIN the anchor only - deck_card by card id, then the participants
 *  by (deck_hash, battle_time) - so the distinct pilots per pair are
 *  exact and the scan is a fraction of the population (0122: a pair
 *  rollup was 25M rows to group on the micro and never landed). */
export async function rollupSynergy(
  db,
  roll,
  { anchorId, anchorForm, minPair, limit, season, types },
) {
  const banded = roll.trophyBand !== null && roll.trophyBand !== undefined;
  const cardTable = banded ? "card_meta_season_band" : "card_meta_season";
  const {
    rows: [anchor],
  } = await db.query(
    `select battles, wins, players from ${cardTable}
     where season_month = $1 and mode_group = $2 and card_id = $3 and form = $4
       ${banded ? "and trophy_band = $5" : ""}`,
    banded
      ? [roll.month, roll.modeGroup, anchorId, anchorForm, roll.trophyBand]
      : [roll.month, roll.modeGroup, anchorId, anchorForm],
  );
  const params = [
    season.starts_at,
    season.ends_at,
    anchorId,
    roll.month,
    roll.modeGroup,
    minPair,
    limit,
  ];
  const formClause =
    anchorForm >= 0 ? `and a.form = $${params.push(anchorForm)}` : "";
  const typeClause = types ? `and bp.type = any($${params.push(types)})` : "";
  const bandClause = banded
    ? `and ${trophyBandClause(roll.trophyBand, params)}`
    : "";
  const bandJoin = banded
    ? `and bl.trophy_band = $${params.push(roll.trophyBand)}`
    : "";
  const { rows: partners } = await db.query(
    `with anchored as (
       select a.deck_hash from deck_card a
       where a.card_id = $3 ${formClause}),
     dp as (
       select bp.deck_hash, bp.player_tag,
              count(*)::int as battles,
              count(*) filter (where bp.outcome = 'win')::int as wins
       from anchored ad
       join battle_participant bp on bp.deck_hash = ad.deck_hash
       where bp.battle_time >= $1 and bp.battle_time < $2
         and bp.outcome in ('win', 'loss') and bp.type_class = 'pvp' ${typeClause} ${bandClause}
       group by bp.deck_hash, bp.player_tag),
     pairs as (
       select dc.card_id, dc.form,
              sum(dp.battles)::int as co_battles,
              sum(dp.wins)::int as wins,
              count(distinct dp.player_tag)::int as players
       from dp join deck_card dc on dc.deck_hash = dp.deck_hash
       where dc.card_id <> $3
       group by dc.card_id, dc.form)
     select p.card_id, c.name, p.form, p.co_battles, p.wins, p.players,
            bl.battles as baseline_battles
     from pairs p
     join card c on c.card_id = p.card_id
     join ${cardTable} bl
       on bl.season_month = $4 and bl.mode_group = $5
      and bl.card_id = p.card_id and bl.form = p.form ${bandJoin}
     where p.co_battles >= $6
     order by p.co_battles desc, p.players desc
     limit $7`,
    params,
  );
  return {
    anchor: anchor ?? { battles: 0, wins: 0, players: 0 },
    partners,
  };
}
