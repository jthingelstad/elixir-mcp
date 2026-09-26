/**
 * Cards played, as rows (0091).
 *
 * battle_participant.deck is the API's cards array as jsonb; deck_hash is
 * the contract's deck identity. Neither was traversable: every card
 * question re-exploded the JSON with no index to help. These three
 * projections are derived from the same canonical participant the
 * battle writer already built, in the same transaction, so they can
 * never disagree with the JSON they are cut from:
 *
 *   deck                    (deck_hash) one row per identity
 *   deck_card               the identity's cards, by form
 *   battle_participant_card what this participant played, with levels
 *
 * A card in a battle that the catalog does not know yet - a release day,
 * up to the daily /cards poll - gets a stub card row (id, name, kind are
 * in the payload) so ingest never waits on the catalog, and a live-lane
 * catalog job is queued so the stub heals in minutes. catalog_seen_at
 * stays null until /cards confirms it.
 *
 * Re-ingest writes nothing: every statement is on-conflict-guarded so an
 * unchanged resubmission leaves every row version where it was.
 */

/** The (round, slot, card) rows a canonical participant's deck JSON
 *  holds. slot 1..8 as the API listed the cards; slot 0 is the tower
 *  troop; round 0 except for duels, where each round is its own deck. */
import { cachedVocabulary, stampDecks } from "./card-roles.mjs";

export function participantCardRows(deck) {
  if (!deck) return [];
  const out = [];
  const push = (round, cards, kind, slotBase) => {
    if (!Array.isArray(cards)) return;
    cards.forEach((c, i) => {
      if (!Number.isInteger(c?.id)) return;
      out.push({
        round,
        card_id: c.id,
        name: typeof c.name === "string" ? c.name : null,
        kind,
        form: Number.isInteger(c.evolutionLevel) ? c.evolutionLevel : 0,
        slot: slotBase + i,
        level: Number.isInteger(c.level) ? c.level : null,
        star_level: Number.isInteger(c.starLevel) ? c.starLevel : null,
        // Duel rounds only (0151): the API says per card, per round,
        // whether it was played. Null where it does not say.
        used: typeof c.used === "boolean" ? c.used : null,
      });
    });
  };
  if (Array.isArray(deck.rounds)) {
    deck.rounds.forEach((r, i) => push(i + 1, r?.cards, "card", 1));
  } else {
    push(0, deck.cards, "card", 1);
    push(0, deck.supportCards, "support", 0);
  }
  // A card cannot appear twice in one round at the same form (the PK);
  // the API has never sent that, but a payload is not our invariant.
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.round}|${r.card_id}|${r.form}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Make sure every card in `cards` ({card_id, name, kind}) has a catalog
 *  row. Existing rows are untouched; missing ones become stubs with
 *  catalog_seen_at null, and one live catalog fetch is queued so the
 *  next collector pass fills them in. Returns the stubbed ids. */
export async function ensureCards(db, cards, observedAt) {
  const byId = new Map();
  for (const c of cards) {
    if (!Number.isInteger(c?.card_id)) continue;
    if (!byId.has(c.card_id))
      byId.set(c.card_id, {
        card_id: c.card_id,
        name: c.name ?? `card ${c.card_id}`,
        kind: c.kind === "support" ? "support" : "card",
      });
  }
  if (byId.size === 0) return [];
  const rows = [...byId.values()].sort((a, b) => a.card_id - b.card_id);
  const { rows: stubbed } = await db.query(
    `insert into card (card_id, name, kind, first_seen_at, observed_at, catalog_seen_at)
     select r.card_id, r.name, r.kind, $2, $2, null
     from jsonb_to_recordset($1::jsonb) as r(card_id int, name text, kind text)
     on conflict (card_id) do nothing
     returning card_id`,
    [JSON.stringify(rows), observedAt],
  );
  if (stubbed.length > 0) {
    // Same upsert as the scheduler's enqueueJob (ledger.mjs): live beats
    // bulk, nothing downgrades, one queued row per subject.
    await db.query(
      `insert into job (endpoint, entity_key, lane)
       values ('cards', 'GLOBAL', 'live')
       on conflict (endpoint, entity_key) where status = 'queued'
         do update set lane = 'live'`,
    );
  }
  return stubbed.map((r) => r.card_id);
}

/**
 * Project deck identities and played cards for canonical participant
 * rows. `decks` is written for EVERY participant handed in, before the
 * participant rows themselves, because battle_participant.deck_hash now
 * references deck; `played` is written only for the keys in `written`
 * (battle_id|player_tag of participant rows that were inserted or
 * changed), so an unchanged resubmission touches nothing.
 */
export async function projectDecks(db, partRows) {
  const decks = new Map();
  const cards = [];
  const note = (hash, at, fields) => {
    const prior = decks.get(hash);
    if (!prior)
      decks.set(hash, {
        deck_hash: hash,
        ...fields,
        first_seen_at: at,
        last_seen_at: at,
      });
    else {
      if (at < prior.first_seen_at) prior.first_seen_at = at;
      if (at > prior.last_seen_at) prior.last_seen_at = at;
    }
  };
  for (const p of partRows) {
    const played = participantCardRows(p.deck);
    for (const r of played) cards.push(r);
    // A duel's rounds are decks too (0182): each round's eight cards, no
    // tower troop, so a round played with the deck a 1v1 war battle used
    // is the same deck.
    for (const r of p.rounds ?? []) {
      if (!r.deck_hash) continue;
      const own = played.filter((c) => c.round === r.round && c.slot > 0);
      if (own.length !== 8) continue;
      note(r.deck_hash, p.battle_time, {
        tower_troop_id: null,
        card_count: 8,
        cards: own.map((c) => ({ card_id: c.card_id, form: c.form })),
      });
    }
    if (!p.deck_hash || Array.isArray(p.deck?.rounds)) continue;
    const prior = decks.get(p.deck_hash);
    const tower = played.find((r) => r.slot === 0)?.card_id ?? null;
    const count = played.filter((r) => r.slot > 0).length;
    if (!prior) {
      decks.set(p.deck_hash, {
        deck_hash: p.deck_hash,
        tower_troop_id: tower,
        card_count: count,
        first_seen_at: p.battle_time,
        last_seen_at: p.battle_time,
        cards: played
          .filter((r) => r.slot > 0)
          .map((r) => ({ card_id: r.card_id, form: r.form })),
      });
    } else {
      if (p.battle_time < prior.first_seen_at)
        prior.first_seen_at = p.battle_time;
      if (p.battle_time > prior.last_seen_at)
        prior.last_seen_at = p.battle_time;
    }
  }
  const stubbed = await ensureCards(
    db,
    cards,
    partRows.reduce(
      (m, p) => (m === null || p.battle_time > m ? p.battle_time : m),
      null,
    ) ?? new Date().toISOString(),
  );
  if (decks.size > 0) {
    const deckRows = [...decks.values()].sort((a, b) =>
      a.deck_hash < b.deck_hash ? -1 : 1,
    );
    await db.query(
      `insert into deck (deck_hash, tower_troop_id, card_count, first_seen_at, last_seen_at)
       select r.deck_hash, r.tower_troop_id, r.card_count, r.first_seen_at, r.last_seen_at
       from jsonb_to_recordset($1::jsonb)
         as r(deck_hash text, tower_troop_id int, card_count smallint,
              first_seen_at timestamptz, last_seen_at timestamptz)
       on conflict (deck_hash) do update set
         first_seen_at = least(deck.first_seen_at, excluded.first_seen_at),
         last_seen_at = greatest(deck.last_seen_at, excluded.last_seen_at)
       where deck.first_seen_at > excluded.first_seen_at
          or deck.last_seen_at < excluded.last_seen_at`,
      [JSON.stringify(deckRows.map(({ cards: _cards, ...row }) => row))],
    );
    const deckCards = deckRows.flatMap((d) =>
      d.cards.map((c) => ({ deck_hash: d.deck_hash, ...c })),
    );
    await db.query(
      `insert into deck_card (deck_hash, card_id, form)
       select r.deck_hash, r.card_id, r.form
       from jsonb_to_recordset($1::jsonb) as r(deck_hash text, card_id int, form smallint)
       on conflict do nothing`,
      [JSON.stringify(deckCards)],
    );
    // The archetype stamp (0148) on the batch's decks: a new deck is
    // named the moment it exists; a known one is re-stamped cheaply.
    await stampDecks(db, await cachedVocabulary(db), {
      hashes: deckRows.map((d) => d.deck_hash),
    });
  }
  return { cards, stubbed };
}

/** Write battle_participant_card rows for the participants whose keys
 *  are in `written`. `cards` is the per-participant card list from
 *  projectDecks; rows are keyed back by battle_id|player_tag. */
export async function projectPlayedCards(db, partRows, written) {
  const rows = [];
  for (const p of partRows) {
    if (!written.has(`${p.battle_id}|${p.player_tag}`)) continue;
    for (const r of participantCardRows(p.deck)) {
      rows.push({
        battle_id: p.battle_id,
        player_tag: p.player_tag,
        round: r.round,
        card_id: r.card_id,
        form: r.form,
        slot: r.slot,
        level: r.level,
        star_level: r.star_level,
        used: r.used,
      });
    }
  }
  if (rows.length === 0) return 0;
  const { rowCount } = await db.query(
    `insert into battle_participant_card
       (battle_id, player_tag, round, card_id, form, slot, level, star_level, used)
     select r.battle_id, r.player_tag, r.round, r.card_id, r.form, r.slot,
            r.level, r.star_level, r.used
     from jsonb_to_recordset($1::jsonb)
       as r(battle_id text, player_tag text, round smallint, card_id int,
            form smallint, slot smallint, level smallint, star_level smallint,
            used boolean)
     on conflict (battle_id, player_tag, round, card_id, form) do update
       set used = coalesce(battle_participant_card.used, excluded.used)`,
    [JSON.stringify(rows)],
  );
  return rowCount;
}

/** A duel's per-round results (0151), for the participants actually
 *  written. The round decks already ride battle_participant_card.round;
 *  these are the results beside them. `on conflict do update` fills a
 *  row an earlier thin observation left blank without overwriting a
 *  value, the same enrichment rule the participant row follows. */
export async function projectRounds(db, partRows, written) {
  const rows = [];
  for (const p of partRows) {
    if (!written.has(`${p.battle_id}|${p.player_tag}`)) continue;
    for (const r of p.rounds ?? [])
      rows.push({
        battle_id: p.battle_id,
        player_tag: p.player_tag,
        round: r.round,
        crowns: r.crowns,
        king_tower_hp: r.king_tower_hp,
        princess_tower_hp_1: r.princess_tower_hp_1,
        princess_tower_hp_2: r.princess_tower_hp_2,
        elixir_leaked: r.elixir_leaked,
        deck_hash: r.deck_hash ?? null,
        outcome: r.outcome ?? null,
      });
  }
  if (rows.length === 0) return 0;
  // A blank is filled, a value never overwritten, and a conflict that
  // fills nothing writes nothing (no new tuple for an unchanged row).
  const { rowCount } = await db.query(
    `insert into battle_participant_round
       (battle_id, player_tag, round, crowns, king_tower_hp,
        princess_tower_hp_1, princess_tower_hp_2, elixir_leaked,
        deck_hash, outcome)
     select r.battle_id, r.player_tag, r.round, r.crowns, r.king_tower_hp,
            r.princess_tower_hp_1, r.princess_tower_hp_2, r.elixir_leaked,
            r.deck_hash, r.outcome
     from jsonb_to_recordset($1::jsonb)
       as r(battle_id text, player_tag text, round smallint, crowns smallint,
            king_tower_hp smallint, princess_tower_hp_1 smallint,
            princess_tower_hp_2 smallint, elixir_leaked numeric,
            deck_hash text, outcome text)
     on conflict (battle_id, player_tag, round) do update
       set crowns = coalesce(battle_participant_round.crowns, excluded.crowns),
           king_tower_hp = coalesce(battle_participant_round.king_tower_hp, excluded.king_tower_hp),
           princess_tower_hp_1 = coalesce(battle_participant_round.princess_tower_hp_1, excluded.princess_tower_hp_1),
           princess_tower_hp_2 = coalesce(battle_participant_round.princess_tower_hp_2, excluded.princess_tower_hp_2),
           elixir_leaked = coalesce(battle_participant_round.elixir_leaked, excluded.elixir_leaked),
           deck_hash = coalesce(battle_participant_round.deck_hash, excluded.deck_hash),
           outcome = coalesce(battle_participant_round.outcome, excluded.outcome)
     where (battle_participant_round.crowns is null and excluded.crowns is not null)
        or (battle_participant_round.king_tower_hp is null and excluded.king_tower_hp is not null)
        or (battle_participant_round.princess_tower_hp_1 is null and excluded.princess_tower_hp_1 is not null)
        or (battle_participant_round.princess_tower_hp_2 is null and excluded.princess_tower_hp_2 is not null)
        or (battle_participant_round.elixir_leaked is null and excluded.elixir_leaked is not null)
        or (battle_participant_round.deck_hash is null and excluded.deck_hash is not null)
        or (battle_participant_round.outcome is null and excluded.outcome is not null)`,
    [JSON.stringify(rows)],
  );
  return rowCount;
}
