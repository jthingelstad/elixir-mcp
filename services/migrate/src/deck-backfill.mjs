/**
 * Backfill the played-card projections (0091) from battle_participant.deck,
 * and census their agreement with the JSON.
 *
 *   {deck_backfill: {after?: {battle_id, player_tag}, batch?: 5000}}
 *     One keyset batch of participants in PK order: explode the deck
 *     JSON once in SQL, stub unknown cards, write deck / deck_card /
 *     battle_participant_card. Idempotent (on-conflict guarded), so a
 *     batch can be rerun. Returns next_after to pass back, or done: true.
 *     Bounded so no invocation nears the Lambda ceiling on a t4g.micro.
 *
 *   {deck_census: true}
 *     Read-only: participants whose deck_hash has no deck row,
 *     participants with cards but no played rows, stub cards the
 *     catalog has not yet confirmed. All three at zero is the gate for
 *     validating the NOT VALID constraints (the contract phase).
 */

import pg from "pg";

// The three shapes deck JSON takes (ingest participantDeck): a single
// deck {cards, supportCards?}; duel {rounds:[{cards}]}. Levels are on
// the display scale since 0011. Non-numeric oddities become null rather
// than failing the batch; the JSON stays as the record either way.
const EXPLODE = `
  select b.battle_id, b.player_tag, b.deck_hash, b.battle_time,
         0::smallint as round,
         (c.value->>'id')::int as card_id, c.value->>'name' as name, 'card' as kind,
         coalesce((c.value->>'evolutionLevel')::int, 0)::smallint as form,
         c.ord::smallint as slot,
         case when jsonb_typeof(c.value->'level') = 'number' then (c.value->>'level')::numeric::int end as level,
         case when jsonb_typeof(c.value->'starLevel') = 'number' then (c.value->>'starLevel')::numeric::int end as star_level
  from batch b
  cross join lateral jsonb_array_elements(coalesce(b.deck->'cards', '[]'::jsonb))
    with ordinality as c(value, ord)
  where jsonb_typeof(c.value->'id') = 'number'
  union all
  select b.battle_id, b.player_tag, b.deck_hash, b.battle_time,
         0::smallint,
         (c.value->>'id')::int, c.value->>'name', 'support',
         coalesce((c.value->>'evolutionLevel')::int, 0)::smallint,
         0::smallint,
         case when jsonb_typeof(c.value->'level') = 'number' then (c.value->>'level')::numeric::int end,
         case when jsonb_typeof(c.value->'starLevel') = 'number' then (c.value->>'starLevel')::numeric::int end
  from batch b
  cross join lateral jsonb_array_elements(coalesce(b.deck->'supportCards', '[]'::jsonb)) as c(value)
  where jsonb_typeof(c.value->'id') = 'number'
  union all
  select b.battle_id, b.player_tag, null, b.battle_time,
         r.ord::smallint,
         (c.value->>'id')::int, c.value->>'name', 'card',
         coalesce((c.value->>'evolutionLevel')::int, 0)::smallint,
         c.ord::smallint,
         case when jsonb_typeof(c.value->'level') = 'number' then (c.value->>'level')::numeric::int end,
         case when jsonb_typeof(c.value->'starLevel') = 'number' then (c.value->>'starLevel')::numeric::int end
  from batch b
  cross join lateral jsonb_array_elements(coalesce(b.deck->'rounds', '[]'::jsonb))
    with ordinality as r(value, ord)
  cross join lateral jsonb_array_elements(coalesce(r.value->'cards', '[]'::jsonb))
    with ordinality as c(value, ord)
  where jsonb_typeof(c.value->'id') = 'number'`;

export async function deckBackfill(databaseUrl, spec) {
  const batch = Math.min(Math.max(Number(spec?.batch ?? 5000), 100), 20000);
  const after = spec?.after ?? { battle_id: "", player_tag: "" };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  try {
    await db.query("begin");
    await db.query(
      `create temp table played on commit drop as
       with batch as (
         select bp.battle_id, bp.player_tag, bp.deck, bp.deck_hash, bp.battle_time
         from battle_participant bp
         where bp.deck is not null
           and (bp.battle_id, bp.player_tag) > ($1, $2)
         order by bp.battle_id, bp.player_tag
         limit $3
       )
       ${EXPLODE}`,
      [after.battle_id, after.player_tag, batch],
    );
    // The batch's key range, from the participants actually selected
    // (a participant with an empty cards array still advances the cursor).
    const {
      rows: [range],
    } = await db.query(
      `with batch as (
         select bp.battle_id, bp.player_tag
         from battle_participant bp
         where bp.deck is not null
           and (bp.battle_id, bp.player_tag) > ($1, $2)
         order by bp.battle_id, bp.player_tag
         limit $3
       )
       select count(*)::int as n,
              max(battle_id) as last_battle_id,
              (array_agg(player_tag order by battle_id desc, player_tag desc))[1] as last_player_tag
       from batch`,
      [after.battle_id, after.player_tag, batch],
    );
    if (range.n === 0) {
      await db.query("commit");
      return { processed: 0, done: true, ms: Date.now() - started };
    }
    // One participant row can carry the same (round, card, form) twice
    // only if the API did; the PK says once. Dedupe before writing.
    await db.query(
      `create temp table played_1 on commit drop as
       select distinct on (battle_id, player_tag, round, card_id, form) *
       from played order by battle_id, player_tag, round, card_id, form, slot`,
    );
    const { rows: stubbed } = await db.query(
      `insert into card (card_id, name, kind, first_seen_at, observed_at, catalog_seen_at)
       select card_id, coalesce(min(name), 'card ' || card_id), min(kind), min(battle_time), min(battle_time), null
       from played_1 group by card_id
       on conflict (card_id) do nothing
       returning card_id`,
    );
    if (stubbed.length > 0) {
      await db.query(
        `insert into job (endpoint, entity_key, lane) values ('cards', 'GLOBAL', 'live')
         on conflict (endpoint, entity_key) where status = 'queued' do update set lane = 'live'`,
      );
    }
    const { rowCount: decks } = await db.query(
      `insert into deck (deck_hash, tower_troop_id, card_count, first_seen_at, last_seen_at)
       select deck_hash,
              (array_agg(card_id) filter (where slot = 0))[1],
              -- the identity's cards, not the batch's participants times them
              count(distinct (card_id, form)) filter (where slot > 0),
              min(battle_time), max(battle_time)
       from played_1
       where deck_hash is not null and round = 0
       group by deck_hash
       on conflict (deck_hash) do update set
         first_seen_at = least(deck.first_seen_at, excluded.first_seen_at),
         last_seen_at = greatest(deck.last_seen_at, excluded.last_seen_at)
       where deck.first_seen_at > excluded.first_seen_at
          or deck.last_seen_at < excluded.last_seen_at`,
    );
    const { rowCount: deckCards } = await db.query(
      `insert into deck_card (deck_hash, card_id, form)
       select distinct deck_hash, card_id, form
       from played_1
       where deck_hash is not null and round = 0 and slot > 0
       on conflict do nothing`,
    );
    const { rowCount: playedRows } = await db.query(
      `insert into battle_participant_card
         (battle_id, player_tag, round, card_id, form, slot, level, star_level)
       select battle_id, player_tag, round, card_id, form, slot, level, star_level
       from played_1
       on conflict do nothing`,
    );
    await db.query("commit");
    return {
      processed: range.n,
      done: range.n < batch,
      next_after: {
        battle_id: range.last_battle_id,
        player_tag: range.last_player_tag,
      },
      stubbed: stubbed.map((r) => r.card_id),
      decks,
      deck_cards: deckCards,
      played: playedRows,
      ms: Date.now() - started,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

export async function deckCensus(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const {
      rows: [r],
    } = await db.query(
      `select
         (select count(*)::int from battle_participant bp
           where bp.deck_hash is not null
             and not exists (select 1 from deck d where d.deck_hash = bp.deck_hash)) as participants_without_deck,
         (select count(*)::int from battle_participant bp
           where bp.deck is not null
             and (jsonb_array_length(coalesce(bp.deck->'cards', '[]'::jsonb)) > 0
                  or jsonb_array_length(coalesce(bp.deck->'rounds', '[]'::jsonb)) > 0)
             and not exists (select 1 from battle_participant_card c
                              where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag)) as participants_without_played_rows,
         (select count(*)::int from player_card pc
           where not exists (select 1 from card c where c.card_id = pc.card_id)) as collection_rows_without_card,
         (select count(*)::int from card where catalog_seen_at is null) as stub_cards,
         (select count(*)::int from deck) as decks,
         (select count(*)::int from deck_card) as deck_cards,
         (select count(*)::int from battle_participant_card) as played_rows,
         (select count(*)::int from battle_participant where deck is not null) as participants_with_deck`,
    );
    return r;
  } finally {
    await db.end();
  }
}

/** {deck_forms: true} - the evolutionLevel values the recorded deck JSON
 *  actually carries, by card, so the form CHECK encodes what the API
 *  sends rather than what the docs said (one scan; on demand only). */
export async function deckForms(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: forms } = await db.query(
      `select coalesce((c.value->>'evolutionLevel')::int, 0) as form,
              count(*)::int as n,
              count(distinct (c.value->>'id')::int)::int as cards,
              (array_agg(distinct c.value->>'name'))[1:8] as sample_names,
              min(bp.battle_time) as first_seen,
              max(bp.battle_time) as last_seen,
              count(distinct bp.player_tag)::int as players
       from battle_participant bp
       cross join lateral jsonb_array_elements(
         coalesce(bp.deck->'cards', '[]'::jsonb) || coalesce(bp.deck->'supportCards', '[]'::jsonb)) as c(value)
       group by 1 order by 1`,
    );
    const { rows: slots } = await db.query(
      `select coalesce((c.value->>'evolutionLevel')::int, 0) as form,
              c.ord::int as slot, count(*)::int as n
       from battle_participant bp
       cross join lateral jsonb_array_elements(coalesce(bp.deck->'cards', '[]'::jsonb))
         with ordinality as c(value, ord)
       where coalesce((c.value->>'evolutionLevel')::int, 0) > 0
       group by 1, 2 order by 1, 2`,
    );
    return { forms, slots_by_form: slots };
  } finally {
    await db.end();
  }
}
