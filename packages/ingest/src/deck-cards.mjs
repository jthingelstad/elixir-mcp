/**
 * Cards played, on the rows that own them (0255, contracted in 0256).
 *
 * A participant's cards ride battle_participant (round 0 and the tower
 * troop), a duel's rounds ride battle_participant_round, and a deck
 * identity's cards ride deck. Each is built here from the payload and
 * written by the same statement that writes its row, so a participant
 * gets one row version, never a second one for its cards. The per-card
 * tables 0091 made were dropped in 0256.
 *
 * The shape, lossless for every card the API sends:
 *   - the four card arrays are parallel and indexed by slot: element i is
 *     the card the API listed i-th (1-8 in a normal deck). A slot with no
 *     card (an entry without an integer id, or a repeat of an earlier
 *     card at the same form) is a NULL element in all four; a NULL level
 *     or star level is a NULL element where the card id is set.
 *   - the tower troop (supportCards[0]) is battle_participant.tower_*.
 *     The API has only ever sent one; a second would have no column.
 *   - cards is an empty array when round 0 has only a tower troop, so a
 *     null cards means "no round-0 cards" (a duel, or no deck).
 *   - deck.card_ids / card_forms in canonical (card_id, form) order.
 *
 * A card in a battle that the catalog does not know yet - a release day,
 * up to the daily /cards poll - gets a stub card row (id, name, kind are
 * in the payload) so ingest never waits on the catalog, and a live-lane
 * catalog job is queued, when the one budget has a token for it, so the
 * stub heals in minutes. catalog_seen_at
 * stays null until /cards confirms it.
 *
 * Re-ingest writes nothing: every statement is on-conflict-guarded so an
 * unchanged resubmission leaves every row version where it was.
 */

import { cachedVocabulary, stampDecks } from "./card-roles.mjs";
import { enqueueJob, takeLiveToken, refundLiveToken } from "@elixir-mcp/ledger";

/** The (round, slot, card) entries a canonical participant's deck JSON
 *  holds. slot 1..8 as the API listed the cards; slot 0 is the tower
 *  troop; round 0 except for duels, where each round is its own deck. */
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
    // A live catalog read, minted like every other (review 2026-09-27
    // §4.1): one token from the one global budget, taken first and given
    // back if a queued catalog job was already there to promote. With no
    // token left nothing is queued; the daily catalog read still heals
    // the stub, and ingest never waits on the catalog.
    const token = await takeLiveToken(db);
    if (token.ok) {
      const row = await enqueueJob(db, {
        endpoint: "cards",
        entity_key: "GLOBAL",
        lane: "live",
      });
      if (!row.inserted) await refundLiveToken(db);
    }
  }
  return stubbed.map((r) => r.card_id);
}

/** Slot-indexed arrays from card entries (slot >= 1): element slot-1
 *  is that slot's card, a slot with no entry a NULL element in every
 *  array. Null when there are no entries. */
function slotArrays(entries) {
  if (entries.length === 0) return null;
  const size = Math.max(...entries.map((e) => e.slot));
  const out = {
    cards: Array(size).fill(null),
    card_forms: Array(size).fill(null),
    card_levels: Array(size).fill(null),
    card_stars: Array(size).fill(null),
    cards_used: Array(size).fill(null),
  };
  for (const e of entries) {
    out.cards[e.slot - 1] = e.card_id;
    out.card_forms[e.slot - 1] = e.form;
    out.card_levels[e.slot - 1] = e.level;
    out.card_stars[e.slot - 1] = e.star_level;
    out.cards_used[e.slot - 1] = e.used;
  }
  return out;
}

/** A participant's round-0 cards and tower troop as battle_participant
 *  columns (0255). Every column is null for a duel (its rounds hold the
 *  decks) or a participant with no deck; cards is [] when round 0 holds
 *  only a tower troop. */
export function participantArrays(deck) {
  const rows = participantCardRows(deck).filter((r) => r.round === 0);
  const tower = rows.find((r) => r.kind === "support") ?? null;
  const played = rows.filter((r) => r.kind === "card");
  const arrays =
    slotArrays(played) ??
    (tower
      ? { cards: [], card_forms: [], card_levels: [], card_stars: [] }
      : null);
  return {
    cards: arrays?.cards ?? null,
    card_forms: arrays?.card_forms ?? null,
    card_levels: arrays?.card_levels ?? null,
    card_stars: arrays?.card_stars ?? null,
    tower_troop_id: tower?.card_id ?? null,
    tower_form: tower?.form ?? null,
    tower_level: tower?.level ?? null,
    tower_star: tower?.star_level ?? null,
  };
}

/** A duel's rounds as battle_participant_round card columns (0255), by
 *  round number (1-based). A round with no cards is absent. */
export function roundArrays(deck) {
  const byRound = new Map();
  for (const r of participantCardRows(deck)) {
    if (r.round < 1) continue;
    if (!byRound.has(r.round)) byRound.set(r.round, []);
    byRound.get(r.round).push(r);
  }
  const out = new Map();
  for (const [round, rows] of byRound) out.set(round, slotArrays(rows));
  return out;
}

/** A deck identity row for the deck insert: its cards in canonical
 *  (card_id, form) order as card_ids / card_forms, null when it has
 *  none. */
function deckIdentityRow({ cards, ...row }) {
  const sorted = [...cards].sort(
    (a, b) => a.card_id - b.card_id || a.form - b.form,
  );
  return {
    ...row,
    card_ids: sorted.length ? sorted.map((c) => c.card_id) : null,
    card_forms: sorted.length ? sorted.map((c) => c.form) : null,
  };
}

/**
 * Project deck identities for canonical participant rows, with their
 * cards as arrays (0255), and stub any card the catalog does not know.
 * Written for EVERY participant handed in, before the participant rows
 * themselves, because battle_participant.deck_hash references deck.
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
      `insert into deck (deck_hash, tower_troop_id, card_count, first_seen_at, last_seen_at,
                         card_ids, card_forms)
       select r.deck_hash, r.tower_troop_id, r.card_count, r.first_seen_at, r.last_seen_at,
              r.card_ids, r.card_forms
       from jsonb_to_recordset($1::jsonb)
         as r(deck_hash text, tower_troop_id int, card_count smallint,
              first_seen_at timestamptz, last_seen_at timestamptz,
              card_ids integer[], card_forms smallint[])
       on conflict (deck_hash) do update set
         first_seen_at = least(deck.first_seen_at, excluded.first_seen_at),
         last_seen_at = greatest(deck.last_seen_at, excluded.last_seen_at),
         card_ids = coalesce(deck.card_ids, excluded.card_ids),
         card_forms = coalesce(deck.card_forms, excluded.card_forms)
       where deck.first_seen_at > excluded.first_seen_at
          or deck.last_seen_at < excluded.last_seen_at
          or (deck.card_ids is null and excluded.card_ids is not null)`,
      [JSON.stringify(deckRows.map(deckIdentityRow))],
    );
    // The archetype stamp (0148) on the batch's decks: a new deck is
    // named the moment it exists; a known one is re-stamped cheaply.
    await stampDecks(db, await cachedVocabulary(db), {
      hashes: deckRows.map((d) => d.deck_hash),
    });
  }
  return { cards, stubbed };
}

/** A duel's per-round results (0151) and each round's cards (0255), for
 *  the participants actually written. `on conflict do update` fills a
 *  row an earlier thin observation left blank without overwriting a
 *  value, the same enrichment rule the participant row follows. */
export async function projectRounds(db, partRows, written) {
  const rows = [];
  for (const p of partRows) {
    if (!written.has(`${p.battle_id}|${p.player_tag}`)) continue;
    const cards = roundArrays(p.deck);
    for (const r of p.rounds ?? []) {
      const a = cards.get(r.round) ?? null;
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
        cards: a?.cards ?? null,
        card_forms: a?.card_forms ?? null,
        card_levels: a?.card_levels ?? null,
        card_stars: a?.card_stars ?? null,
        cards_used: a?.cards_used ?? null,
      });
    }
  }
  if (rows.length === 0) return 0;
  // A blank is filled, a value never overwritten, and a conflict that
  // fills nothing writes nothing (no new tuple for an unchanged row).
  // cards_used fills element by element: a later observation that says
  // whether a card was played fills a slot an earlier one left unsaid.
  const t = "battle_participant_round";
  const used = `case when ${t}.cards_used is null then excluded.cards_used
                     when excluded.cards_used is null then ${t}.cards_used
                     else (select array_agg(coalesce(u.a, u.b) order by u.i)
                           from unnest(${t}.cards_used, excluded.cards_used)
                             with ordinality as u(a, b, i)) end`;
  const { rowCount } = await db.query(
    `insert into battle_participant_round
       (battle_id, player_tag, round, crowns, king_tower_hp,
        princess_tower_hp_1, princess_tower_hp_2, elixir_leaked,
        deck_hash, outcome, cards, card_forms, card_levels, card_stars,
        cards_used)
     select r.battle_id, r.player_tag, r.round, r.crowns, r.king_tower_hp,
            r.princess_tower_hp_1, r.princess_tower_hp_2, r.elixir_leaked,
            r.deck_hash, r.outcome, r.cards, r.card_forms, r.card_levels,
            r.card_stars, r.cards_used
     from jsonb_to_recordset($1::jsonb)
       as r(battle_id text, player_tag text, round smallint, crowns smallint,
            king_tower_hp smallint, princess_tower_hp_1 smallint,
            princess_tower_hp_2 smallint, elixir_leaked numeric,
            deck_hash text, outcome text, cards integer[],
            card_forms smallint[], card_levels smallint[],
            card_stars smallint[], cards_used boolean[])
     on conflict (battle_id, player_tag, round) do update
       set crowns = coalesce(${t}.crowns, excluded.crowns),
           king_tower_hp = coalesce(${t}.king_tower_hp, excluded.king_tower_hp),
           princess_tower_hp_1 = coalesce(${t}.princess_tower_hp_1, excluded.princess_tower_hp_1),
           princess_tower_hp_2 = coalesce(${t}.princess_tower_hp_2, excluded.princess_tower_hp_2),
           elixir_leaked = coalesce(${t}.elixir_leaked, excluded.elixir_leaked),
           deck_hash = coalesce(${t}.deck_hash, excluded.deck_hash),
           outcome = coalesce(${t}.outcome, excluded.outcome),
           cards = coalesce(${t}.cards, excluded.cards),
           card_forms = coalesce(${t}.card_forms, excluded.card_forms),
           card_levels = coalesce(${t}.card_levels, excluded.card_levels),
           card_stars = coalesce(${t}.card_stars, excluded.card_stars),
           cards_used = ${used}
     where (${t}.crowns is null and excluded.crowns is not null)
        or (${t}.king_tower_hp is null and excluded.king_tower_hp is not null)
        or (${t}.princess_tower_hp_1 is null and excluded.princess_tower_hp_1 is not null)
        or (${t}.princess_tower_hp_2 is null and excluded.princess_tower_hp_2 is not null)
        or (${t}.elixir_leaked is null and excluded.elixir_leaked is not null)
        or (${t}.deck_hash is null and excluded.deck_hash is not null)
        or (${t}.outcome is null and excluded.outcome is not null)
        or (${t}.cards is null and excluded.cards is not null)
        or (${t}.card_forms is null and excluded.card_forms is not null)
        or (${t}.card_levels is null and excluded.card_levels is not null)
        or (${t}.card_stars is null and excluded.card_stars is not null)
        or ${t}.cards_used is distinct from ${used}`,
    [JSON.stringify(rows)],
  );
  return rowCount;
}
