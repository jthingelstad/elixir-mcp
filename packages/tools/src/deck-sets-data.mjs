/**
 * The reads behind the deck-set tools (battles_deck_sets 9.4.0,
 * battles_deck_upgrades 9.7.0): the season's decks checked against a
 * player's collection, their records per mode, the corpus priors, each
 * card's measured form advantage, and the player's own decks. One place,
 * so the two tools value a deck the same way.
 *
 * A candidate is a CARD SET, not a deck_hash (9.8.0). deck_hash carries
 * the tower troop, and Clan Wars battles carry none (a live battle log,
 * 2026-09-26: every riverRacePvP and riverRaceDuel entry had
 * `supportCards: []`, every Trophy Road entry a tower troop), so the same
 * eight cards were a Trophy Road identity and a separate war identity and
 * a deck's war record never pooled with its ladder record. A set's
 * constraint is about cards anyway (the tower troop is not one of the 32),
 * so every variant's record pools under its eight cards. A duel's rounds
 * are games in the season rollup itself (9.11.0, feedback #363: a war
 * deck played only in duels was invisible), every player's, so a set's
 * war record holds them with no merge here; the player's own rounds
 * still count toward familiarity (ownGames).
 */
import { deckHash, typesForModeGroup } from "@elixir-mcp/contracts";
import {
  META_METHODOLOGY,
  PARTICIPANT_GAMES,
  ToolFailure,
  fieldedLevel,
  resolveFitFor,
  resolveSeasonWindow,
  subject,
} from "./tools/shared.mjs";
import { seasonRollup } from "./meta-season.mjs";
import {
  FAMILIAR_MIN_BATTLES,
  SET_MODES,
  deckValue,
  formAdvantage,
} from "./deck-sets.mjs";

const COMPETITIVE_TYPES = SET_MODES.flatMap((m) => typesForModeGroup(m));

/**
 * What both deck tools start from: the player, their collection, the
 * season and its rollup, the level they field now (the target a held
 * level reads against), the corpus priors per mode and each card's
 * measured form advantage.
 */
export async function deckSetContext(ctx, args, what) {
  const { tag } = await subject(
    ctx.db,
    ctx.account,
    args.player_tag,
    "summary",
    args.on_behalf_of,
    args.display_name,
  );
  let fit;
  try {
    fit = await resolveFitFor(ctx.db, tag);
  } catch (err) {
    if (err instanceof ToolFailure && err.code === "not_recorded")
      throw new ToolFailure(
        "not_recorded",
        `No collection recorded for ${tag}, so there is nothing to build ${what} from.`,
        "The collection is read from the player's profile: players_profile({ live: true }) fetches one now; ask again once it has landed.",
      );
    throw err;
  }
  const win = await resolveSeasonWindow(ctx, { season: args.season });
  const roll = await seasonRollup(ctx.db, { win, seg: null, mode: null });
  if (!roll)
    throw new ToolFailure(
      "not_recorded",
      `No season rollup covers ${win.season?.season_month ?? "that window"} yet.`,
      `${what[0].toUpperCase()}${what.slice(1)} read the season's deck rollup, rebuilt nightly; pass season:'previous' for the last full season.`,
    );
  const from = win.from.toISOString();
  const to = win.to ? win.to.toISOString() : null;
  const fielded = await fieldedLevel(ctx.db, tag, {
    from,
    to,
    types: COMPETITIVE_TYPES,
  });
  const priors = await seasonPriors(ctx.db, win);
  const forms = await formAdvantages(
    ctx.db,
    roll.month,
    roll.prior.mean ?? 0.5,
  );
  const { rows } = await ctx.db.query(
    "select name from player where player_tag = $1",
    [tag],
  );
  return {
    tag,
    name: rows[0]?.name ?? null,
    fit,
    win,
    roll,
    from,
    to,
    fielded,
    target: fielded.recent_mean_level ?? fielded.mean_level,
    priors,
    forms,
  };
}

/**
 * A card set's value for the context's player: its pooled record, the
 * level they would field it at (with `raised`, id -> level, applied), the
 * forms they lack (less those in `unlocked`, `id:form`) priced, and the
 * familiarity of their own games. Null when the set has no record.
 */
export function valueOfSet(set, c, { raised = null, unlocked = null } = {}) {
  let ownMean = set.own_mean;
  if (raised && set.owned) {
    const levels = set.ids.map(
      (id) => raised.get(id) ?? c.fit.held.get(id)?.level ?? null,
    );
    ownMean = levels.some((l) => l === null)
      ? null
      : levels.reduce((sum, l) => sum + l, 0) / levels.length;
  }
  const swaps = substitutions(
    set.missing_forms.filter((k) => !unlocked?.has(k)),
    c.forms,
  );
  const v = deckValue({
    modes: set.modes,
    priors: c.priors,
    ownMean,
    target: c.target,
    yours: set.yours,
    formTerm: -swaps.reduce((sum, x) => sum + x.advantage, 0),
    m: META_METHODOLOGY.prior_strength,
  });
  return v ? { ...v, swaps } : null;
}

/** The corpus mean win rate per mode this season (0.5 when unknown). */
async function seasonPriors(db, win) {
  const priors = {};
  for (const mode of SET_MODES) {
    const m = await seasonRollup(db, { win, seg: null, mode });
    priors[mode] = m?.prior?.mean ?? 0.5;
  }
  return priors;
}

/** Each card's measured form advantage this season, by `${id}:${form}`,
 *  and the season's median where a card's forms are too thin. */
async function formAdvantages(db, month, prior) {
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

/** A card set's key: its `id:form` pairs, sorted as the contract sorts
 *  them; the tower troop is not part of it. */
function setKey(pairs) {
  return [...pairs].sort().join(",");
}

function pairsOf(key) {
  return key.split(",").map((p) => {
    const [id, form] = p.split(":").map(Number);
    return { id, form };
  });
}

/** Every deck_hash eight cards can carry: without a tower troop (every
 *  Clan Wars battle) and with each tower troop in the catalog. */
function variantHashes(pairs, towers) {
  const cards = pairs.map(({ id, form }) => ({
    id,
    ...(form ? { evolutionLevel: form } : {}),
  }));
  return [
    { deck_hash: deckHash({ cards }), tower_troop_id: null },
    ...towers.map((t) => ({
      deck_hash: deckHash({ cards, towerTroopId: t }),
      tower_troop_id: t,
    })),
  ];
}

/** The player's own games this season (competitive modes) per card set:
 *  decided games by their deck's cards, a duel's rounds among them, each
 *  won or lost by its own crowns (9.11.0; `rounds` counts those). */
async function ownGames(db, tag, { from, to }) {
  const own = new Map();
  const { rows } = await db.query(
    `select o.deck_hash, o.n, o.rounds, array_agg(dc.card_id || ':' || dc.form) as pairs
       from (select deck_hash, count(*)::int as n,
                    count(*) filter (where round > 0)::int as rounds
               from ${PARTICIPANT_GAMES} bp
              where player_tag = $1 and battle_time >= $2
                and ($3::timestamptz is null or battle_time < $3)
                and type = any($4) and type_class = 'pvp'
                and outcome in ('win', 'loss') and deck_hash is not null
              group by deck_hash) o
       join deck_card dc on dc.deck_hash = o.deck_hash
      group by o.deck_hash, o.n, o.rounds`,
    [tag, from, to, COMPETITIVE_TYPES],
  );
  for (const r of rows) {
    if (r.pairs?.length !== 8) continue;
    const key = setKey(r.pairs);
    const o = own.get(key) ?? { games: 0, rounds: 0 };
    o.games += r.n;
    o.rounds += r.rounds;
    own.set(key, o);
  }
  return own;
}

/** The candidate card sets this season, each checked against the
 *  collection, with every variant's record pooled per mode:
 *
 *    admitted: a variant over the gates admits its cards: min_battles
 *              over the three competitive modes, min_players in any one
 *              (a deck played mostly in casual or challenges never
 *              passed on those and then valued on one war battle);
 *              a set the player has played
 *              FAMILIAR_MIN_BATTLES+ games on (duel rounds included) is
 *              always admitted.
 *    extra:    card set keys to build whatever the gates say (locks).
 *
 *  Each set: key, ids, pairs, owned, missing_ids, missing_forms
 *  (`id:form`), min_level, own_mean, modes ({ [mode]: { battles, wins,
 *  losses, mean_level_gap, duel_rounds } }), variants ([{
 *  deck_hash, tower_troop_id, battles }], most played first), deck_hash
 *  (the most played variant, else the tower-less identity), yours (the
 *  player's games on these cards) and your_rounds. */
export async function seasonCardSets(
  db,
  { month, minBattles, minPlayers, tag, from, to, held, extra = [] },
) {
  const own = await ownGames(db, tag, { from, to });
  const { rows: gated } = await db.query(
    `with cand as (
       select deck_hash from deck_meta_season
        where season_month = $1 and mode_group = any($4)
        group by deck_hash
       having sum(battles) >= $2
          and max(coalesce(repeat_players, players, 0)) >= $3
     )
     select c.deck_hash, array_agg(dc.card_id || ':' || dc.form) as pairs
       from cand c join deck_card dc on dc.deck_hash = c.deck_hash
      group by c.deck_hash
     having count(distinct dc.card_id) = 8`,
    [month, minBattles, minPlayers, SET_MODES],
  );
  const keys = new Set(gated.map((r) => setKey(r.pairs)));
  for (const [key, o] of own)
    if (o.games >= FAMILIAR_MIN_BATTLES) keys.add(key);
  for (const key of extra) keys.add(key);
  return buildSets(db, { month, keys: [...keys], held, own });
}

/** The card sets of recorded deck_hash values (a lock): hash -> key, for
 *  the hashes the record holds. */
export async function keysOfHashes(db, hashes) {
  if (!hashes.length) return new Map();
  const { rows } = await db.query(
    `select deck_hash, array_agg(card_id || ':' || form) as pairs
       from deck_card where deck_hash = any($1) group by deck_hash`,
    [hashes],
  );
  return new Map(rows.map((r) => [r.deck_hash, setKey(r.pairs)]));
}

const emptyMode = () => ({
  battles: 0,
  wins: 0,
  losses: 0,
  duel_rounds: 0,
  gap_sum: 0,
  gap_battles: 0,
});

async function buildSets(db, { month, keys, held, own }) {
  const { rows: towerRows } = await db.query(
    `select card_id from card where kind = 'support' order by card_id`,
  );
  const towers = towerRows.map((r) => r.card_id);
  const hashes = [];
  const sets = keys.map((key) => {
    const pairs = pairsOf(key);
    const variants = variantHashes(pairs, towers);
    for (const v of variants) hashes.push(v.deck_hash);
    return { key, pairs, variants };
  });
  const records = new Map();
  if (hashes.length) {
    const { rows } = await db.query(
      `select deck_hash, mode_group, battles, wins, losses,
              level_gap_sum, level_gap_battles, duel_rounds
         from deck_meta_season
        where season_month = $1 and mode_group = any($2) and deck_hash = any($3)`,
      [month, SET_MODES, hashes],
    );
    for (const r of rows) {
      if (!records.has(r.deck_hash)) records.set(r.deck_hash, []);
      records.get(r.deck_hash).push(r);
    }
  }
  return sets
    .map(({ key, pairs, variants }) => {
      const ids = pairs.map((p) => p.id);
      if (new Set(ids).size !== 8) return null;
      const modes = {};
      const recorded = [];
      for (const v of variants) {
        const rows = records.get(v.deck_hash) ?? [];
        if (!rows.length) continue;
        recorded.push({
          ...v,
          battles: rows.reduce((s, r) => s + r.battles, 0),
        });
        for (const r of rows) {
          const m = (modes[r.mode_group] ??= emptyMode());
          m.battles += r.battles;
          m.wins += r.wins;
          m.losses += r.losses;
          // Null on a row the nightly has not split since 0183: the
          // mode's count is then unknown, not zero.
          m.duel_rounds =
            m.duel_rounds === null || r.duel_rounds === null
              ? null
              : m.duel_rounds + r.duel_rounds;
          m.gap_sum += Number(r.level_gap_sum ?? 0);
          m.gap_battles += r.level_gap_battles ?? 0;
        }
      }
      const mine = own.get(key);
      for (const m of Object.values(modes)) {
        m.mean_level_gap = m.gap_battles
          ? Number((m.gap_sum / m.gap_battles).toFixed(2))
          : null;
        delete m.gap_sum;
        delete m.gap_battles;
      }
      recorded.sort((a, z) => z.battles - a.battles);
      // Against the collection: a card not owned, a form not unlocked
      // (`id:form`), the held levels.
      const levels = [];
      const missingIds = [];
      const missingForms = [];
      for (const { id, form } of pairs) {
        const h = held.get(id);
        if (!h) {
          missingIds.push(id);
          continue;
        }
        if (form !== 0 && ((h.forms ?? 0) & form) === 0)
          missingForms.push(`${id}:${form}`);
        if (h.level !== null && h.level !== undefined) levels.push(h.level);
      }
      const owned = missingIds.length === 0;
      return {
        key,
        ids,
        pairs,
        deck_hash: recorded[0]?.deck_hash ?? variants[0].deck_hash,
        variants: recorded,
        modes,
        owned,
        missing_ids: missingIds,
        missing_forms: missingForms,
        min_level: levels.length ? Math.min(...levels) : null,
        own_mean:
          owned && levels.length === 8
            ? Number((levels.reduce((s, l) => s + l, 0) / 8).toFixed(3))
            : null,
        yours: mine?.games ?? 0,
        your_rounds: mine?.rounds ?? 0,
      };
    })
    .filter(Boolean);
}

/** The forms a deck needs that the player lacks, each with its price. */
function substitutions(missingForms, forms) {
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
