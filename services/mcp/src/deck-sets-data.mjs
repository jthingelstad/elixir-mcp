/**
 * The reads behind the deck-set tools (battles_deck_sets 9.4.0,
 * battles_deck_upgrades 9.7.0): the season's decks checked against a
 * player's collection, their records per mode, the corpus priors, each
 * card's measured form advantage, and the player's own decks. One place,
 * so the two tools value a deck the same way.
 */
import { typesForModeGroup } from "@elixir-mcp/contracts";
import { META_METHODOLOGY } from "./tools/shared.mjs";
import { seasonRollup } from "./meta-season.mjs";
import {
  FAMILIAR_MIN_BATTLES,
  SET_MODES,
  formAdvantage,
} from "./deck-sets.mjs";

export const COMPETITIVE_TYPES = SET_MODES.flatMap((m) => typesForModeGroup(m));

/** The corpus mean win rate per mode this season (0.5 when unknown). */
export async function seasonPriors(db, win) {
  const priors = {};
  for (const mode of SET_MODES) {
    const m = await seasonRollup(db, { win, seg: null, mode });
    priors[mode] = m?.prior?.mean ?? 0.5;
  }
  return priors;
}

/** Each card's measured form advantage this season, by `${id}:${form}`,
 *  and the season's median where a card's forms are too thin. */
export async function formAdvantages(db, month, prior) {
  const { rows } = await db.query(
    `select card_id, form, battles, wins from card_meta_season
      where season_month = $1 and mode_group = 'all' and form in (0, 1, 2)`,
    [month],
  );
  const byCard = new Map();
  for (const r of rows) {
    if (!byCard.has(r.card_id)) byCard.set(r.card_id, {});
    byCard.get(r.card_id)[r.form] = r;
  }
  const measured = [];
  const advantage = new Map();
  for (const [id, forms] of byCard)
    for (const form of [1, 2]) {
      const a = formAdvantage({
        form: forms[form],
        base: forms[0],
        prior,
        m: META_METHODOLOGY.prior_strength,
      });
      if (a !== null) {
        advantage.set(`${id}:${form}`, a);
        measured.push(a);
      }
    }
  measured.sort((a, z) => a - z);
  return {
    advantage,
    median: measured.length ? measured[Math.floor(measured.length / 2)] : 0,
  };
}

/** The player's own decided decks this season (competitive modes): the
 *  battles per deck, and the decks they know (FAMILIAR_MIN_BATTLES+). */
export async function ownDecks(db, tag, { from, to }) {
  const { rows } = await db.query(
    `select deck_hash, count(*)::int as n from battle_participant
      where player_tag = $1 and battle_time >= $2
        and ($3::timestamptz is null or battle_time < $3)
        and type = any($4) and type_class = 'pvp'
        and outcome in ('win', 'loss') and deck_hash is not null
      group by deck_hash`,
    [tag, from, to, COMPETITIVE_TYPES],
  );
  return {
    yours: new Map(rows.map((r) => [r.deck_hash, r.n])),
    familiar: rows
      .filter((r) => r.n >= FAMILIAR_MIN_BATTLES)
      .map((r) => r.deck_hash),
  };
}

/** The season rollup's eight-card decks over the gates (or the player's
 *  own), checked against the collection in SQL: owned, the forms not
 *  unlocked (`id:form`), the lowest and mean held level, the card ids. */
export async function seasonDeckPool(
  db,
  { month, minBattles, minPlayers, tag, familiar },
) {
  const { rows } = await db.query(
    `with cand as (
       select deck_hash from deck_meta_season
        where season_month = $1 and mode_group = 'all'
          and ((battles >= $2 and coalesce(repeat_players, players, 0) >= $3)
               or deck_hash = any($5))
     ),
     held as (
       select card_id, level, coalesce(evolution_level, 0) as ev
         from player_card where player_tag = $4
     )
     select c.deck_hash,
            bool_and(h.card_id is not null) as owned,
            array_agg(dc.card_id || ':' || dc.form)
              filter (where h.card_id is not null and dc.form <> 0 and (h.ev & dc.form) = 0)
              as missing_forms,
            min(h.level) as min_level,
            round(avg(h.level)::numeric, 3) as own_mean,
            array_agg(dc.card_id order by dc.card_id) as card_ids
       from cand c
       join deck_card dc on dc.deck_hash = c.deck_hash
       left join held h on h.card_id = dc.card_id
      group by c.deck_hash
     having count(distinct dc.card_id) = 8`,
    [month, minBattles, minPlayers, tag, familiar],
  );
  return rows;
}

/** Each deck's record per competitive mode, with its players' level edge. */
export async function modeRecords(db, month, hashes) {
  const modes = new Map();
  if (!hashes.length) return modes;
  const { rows } = await db.query(
    `select deck_hash, mode_group, battles, wins, losses,
            round((level_gap_sum / nullif(level_gap_battles, 0))::numeric, 2) as mean_level_gap
       from deck_meta_season
      where season_month = $1 and mode_group = any($2) and deck_hash = any($3)`,
    [month, SET_MODES, hashes],
  );
  for (const r of rows) {
    if (!modes.has(r.deck_hash)) modes.set(r.deck_hash, {});
    modes.get(r.deck_hash)[r.mode_group] = {
      battles: r.battles,
      wins: r.wins,
      losses: r.losses,
      mean_level_gap:
        r.mean_level_gap === null ? null : Number(r.mean_level_gap),
    };
  }
  return modes;
}

/** The forms a deck needs that the player lacks, each with its price. */
export function substitutions(missingForms, forms) {
  return (missingForms ?? []).map((x) => {
    const [id, form] = x.split(":").map(Number);
    const a = forms.advantage.get(`${id}:${form}`);
    return {
      id,
      form,
      advantage: a ?? forms.median,
      measured: a !== undefined,
    };
  });
}
