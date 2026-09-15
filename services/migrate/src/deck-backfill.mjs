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
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    return await backfillBatch(db, spec);
  } finally {
    await db.end();
  }
}

/** One batch on an already-connected client (the Lambda op wraps this;
 *  tests that seed participants by hand project them through it). */
export async function backfillBatch(db, spec) {
  const batch = Math.min(Math.max(Number(spec?.batch ?? 5000), 100), 20000);
  const after = spec?.after ?? { battle_id: "", player_tag: "" };
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
    // Where 3 comes from: by battle type and by deck length, since a
    // uniform spread across slots 1-12 says ownership, not played-as.
    const { rows: three } = await db.query(
      `select b.type, b.game_mode_name,
              jsonb_array_length(bp.deck->'cards') as deck_len,
              count(*)::int as n, count(distinct bp.player_tag)::int as players,
              count(distinct bp.battle_id)::int as battles
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       cross join lateral jsonb_array_elements(coalesce(bp.deck->'cards', '[]'::jsonb)) as c(value)
       where coalesce((c.value->>'evolutionLevel')::int, 0) = 3
       group by 1, 2, 3 order by n desc`,
    );
    // The census residue: participants with a deck_hash and no deck row.
    const { rows: orphans } = await db.query(
      `select b.type, b.type_class,
              jsonb_typeof(bp.deck) as deck_type,
              (bp.deck ? 'cards') as has_cards,
              jsonb_array_length(coalesce(bp.deck->'cards', '[]'::jsonb)) as cards_len,
              (bp.deck ? 'rounds') as has_rounds,
              count(*)::int as n, min(bp.battle_time) as first_seen, max(bp.battle_time) as last_seen
       from battle_participant bp join battle b on b.battle_id = bp.battle_id
       where bp.deck_hash is not null
         and not exists (select 1 from deck d where d.deck_hash = bp.deck_hash)
       group by 1, 2, 3, 4, 5, 6 order by n desc limit 20`,
    );
    return {
      forms,
      slots_by_form: slots,
      form_3_by_type: three,
      hash_without_deck: orphans,
    };
  } finally {
    await db.end();
  }
}

/** {explain_meta: {clan_tag?, days?}} - EXPLAIN (ANALYZE, BUFFERS) of the
 *  pieces a clan-scoped battles_meta_decks / battles_meta_cards call runs,
 *  on the live database, read-only. Written when 3.4.0's readers moved
 *  onto the card rows and clan meta still took 15-17 s; the plans say
 *  where, guesses did not. */
export async function explainMeta(databaseUrl, spec = {}) {
  const clanTag = String(spec.clan_tag ?? "#J2RGCRVG").toUpperCase();
  const days = Math.min(90, Math.max(1, Number(spec.days ?? 28)));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = 120000");
    const out = [];
    const explain = async (name, text, values) => {
      const started = Date.now();
      const { rows } = await db.query(
        `explain (analyze, buffers, format text) ${text}`,
        values,
      );
      out.push({
        name,
        ms: Date.now() - started,
        plan: rows.map((r) => r["QUERY PLAN"]).join("\n"),
      });
    };
    const scope = `bp.player_tag in (select cm.player_tag from clan_membership cm
                     where cm.clan_tag = $1 and cm.left_observed_at is null)
                   and bp.battle_time >= $2`;
    await explain(
      "prior (index-only?)",
      `select count(*)::int as decided, count(*) filter (where bp.outcome = 'win')::int as wins
       from battle_participant bp
       where bp.outcome in ('win','loss') and bp.type_class = 'pvp'
         and bp.deck_hash is not null and bp.battle_time >= $1`,
      [from],
    );
    await explain(
      "excluded breakdown (clan scope)",
      `select count(*)::int as considered,
              count(*) filter (where b.type_class = 'boat')::int as boat,
              count(*) filter (where bp.outcome = 'draw' and b.type_class = 'pvp')::int as draws
       from battle_participant bp join battle b on b.battle_id = bp.battle_id
       where ${scope}`,
      [clanTag, from],
    );
    await explain(
      "deck aggregate (clan scope)",
      `select bp.deck_hash, count(*)::int as battles,
              count(*) filter (where bp.outcome = 'win')::int as wins,
              count(distinct bp.player_tag)::int as players,
              min(b.battle_time), max(b.battle_time)
       from battle_participant bp join battle b on b.battle_id = bp.battle_id
       where ${scope} and bp.deck_hash is not null
         and bp.outcome in ('win','loss') and b.type_class = 'pvp'
       group by bp.deck_hash`,
      [clanTag, from],
    );
    await explain(
      "card aggregate (clan scope)",
      `with sides as (
         select bp.player_tag, bp.outcome, pc.card_id, c.name, pc.form as evolution, pc.slot = 1 as first_card
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         join battle_participant_card pc
           on pc.battle_id = bp.battle_id and pc.player_tag = bp.player_tag
          and pc.round = 0 and pc.slot > 0
         join card c on c.card_id = pc.card_id
         where ${scope} and bp.deck_hash is not null
           and bp.outcome in ('win','loss') and b.type_class = 'pvp')
       select card_id, name, evolution, count(*)::int as battles,
              count(distinct player_tag)::int as players
       from sides group by 1, 2, 3`,
      [clanTag, from],
    );
    return { clan_tag: clanTag, days, explains: out };
  } finally {
    await db.end();
  }
}
