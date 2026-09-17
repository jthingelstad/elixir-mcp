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

/** The rollup a read can use, or null. `seg.where` non-empty means a
 *  segment; `win.source === "season"` means the row set both bounds. */
export async function seasonRollup(db, { win, seg, mode }) {
  if (seg?.where || win.source !== "season" || !win.season) return null;
  const month = win.season.season_month;
  const {
    rows: [state],
  } = await db.query(
    `select counters_through, rebuilt_at, final from meta_season_state
     where season_month = $1 and rebuilt_at is not null`,
    [month],
  );
  if (!state) return null;
  const modeGroup = mode ?? "all";
  const {
    rows: [totals],
  } = await db.query(
    `select considered, duels, boat, draws, unresolved, no_deck, decided, wins
     from meta_season_totals where season_month = $1 and mode_group = $2`,
    [month, modeGroup],
  );
  const t = totals ?? {
    considered: 0,
    duels: 0,
    boat: 0,
    draws: 0,
    unresolved: 0,
    no_deck: 0,
    decided: 0,
    wins: 0,
  };
  return {
    month,
    modeGroup,
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

export async function rollupDecks(db, roll, { minBattles }) {
  const { rows } = await db.query(
    `select deck_hash, battles, wins, losses, players, first_used, last_used
     from deck_meta_season
     where season_month = $1 and mode_group = $2 and battles >= $3
     order by battles desc`,
    [roll.month, roll.modeGroup, minBattles],
  );
  return rows;
}

export async function rollupCards(db, roll, { minBattles }) {
  const { rows } = await db.query(
    `select cm.card_id, c.name, cm.form as evolution,
            cm.battles, cm.wins, cm.losses, cm.players
     from card_meta_season cm join card c on c.card_id = cm.card_id
     where cm.season_month = $1 and cm.mode_group = $2 and cm.form >= 0
       and cm.battles >= $3`,
    [roll.month, roll.modeGroup, minBattles],
  );
  return rows;
}

/** The anchor's own row (form -1 = any form) and its partners by form,
 *  with each partner's baseline usage from card_meta_season. */
export async function rollupSynergy(
  db,
  roll,
  { anchorId, anchorForm, minPair, limit },
) {
  const {
    rows: [anchor],
  } = await db.query(
    `select battles, wins, players from card_meta_season
     where season_month = $1 and mode_group = $2 and card_id = $3 and form = $4`,
    [roll.month, roll.modeGroup, anchorId, anchorForm],
  );
  const { rows: partners } = await db.query(
    `select p.card_id, c.name, p.form, p.co_battles, p.wins, p.players,
            bl.battles as baseline_battles
     from (
       select case when card_a = $3 then card_b else card_a end as card_id,
              case when card_a = $3 then form_b else form_a end as form,
              co_battles, wins, players
       from card_pair_season
       where season_month = $1 and mode_group = $2
         and ((card_a = $3 and form_a = $4 and form_b >= 0)
           or (card_b = $3 and form_b = $4 and form_a >= 0))
     ) p
     join card c on c.card_id = p.card_id
     join card_meta_season bl
       on bl.season_month = $1 and bl.mode_group = $2
      and bl.card_id = p.card_id and bl.form = p.form
     where p.co_battles >= $5
     order by p.co_battles desc, p.players desc
     limit $6`,
    [roll.month, roll.modeGroup, anchorId, anchorForm, minPair, limit],
  );
  return {
    anchor: anchor ?? { battles: 0, wins: 0, players: 0 },
    partners,
  };
}
