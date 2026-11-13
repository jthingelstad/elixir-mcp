/**
 * Cards as arrays on the rows that own them (0255).
 *
 * battle_participant_card and deck_card hold one row per card, each
 * carrying a 64-character key; 0255 moves the same facts onto
 * battle_participant (round 0 and the tower troop), battle_participant_round
 * (a duel's rounds) and deck. During the transition both shapes are
 * written, and these fillers are the one way the arrays are made: built
 * in SQL from the card rows already in the database, so the arrays equal
 * the rows by construction. Ingest calls them for the keys it just wrote,
 * in the same transaction; the migrate op {card_arrays} calls them for
 * history. Each update is guarded by IS DISTINCT FROM, so a second call
 * writes nothing.
 *
 * The shape, lossless for every row:
 *   - the four card arrays are parallel and indexed by slot: element i is
 *     the row with slot i. A slot with no row is a NULL element in all
 *     four; a NULL level or star level is a NULL element where the card id
 *     is set.
 *   - slot 0 (the tower troop) is battle_participant.tower_*. A round has
 *     no slot 0 in any payload we have seen.
 *   - cards is an empty array when a participant's round 0 has only a
 *     tower troop, so a null cards means "no round-0 rows" (a duel, or no
 *     deck) and nothing else.
 *   - deck.card_ids / card_forms in canonical (card_id, form) order.
 *
 * Rows that no array can place are left alone and reported by
 * {card_arrays_census}: two rows in one slot (a second supportCards entry
 * would share slot 1 with the first card), or two slot-0 rows.
 */

/** One keys parameter, sorted so concurrent writers take row locks in
 *  the same order. */
const keysJson = (keys) =>
  JSON.stringify(
    [...keys].sort((a, b) => {
      for (const k of Object.keys(a)) {
        if (a[k] < b[k]) return -1;
        if (a[k] > b[k]) return 1;
      }
      return 0;
    }),
  );

const PARTICIPANT_FILL = `
with k as (
  select distinct r.battle_id, r.player_tag
  from jsonb_to_recordset($1::jsonb) as r(battle_id text, player_tag text)
),
src as (
  select c.battle_id, c.player_tag,
         max(c.slot) filter (where c.slot > 0) as max_slot,
         count(*) filter (where c.slot > 0) as n,
         count(distinct c.slot) filter (where c.slot > 0) as nd,
         count(*) filter (where c.slot = 0) as towers,
         count(*) filter (where c.slot < 0) as negative
  from k
  join battle_participant_card c
    on c.battle_id = k.battle_id and c.player_tag = k.player_tag and c.round = 0
  group by c.battle_id, c.player_tag
),
built as (
  select s.battle_id, s.player_tag,
         coalesce(a.cards, '{}') as cards,
         coalesce(a.forms, '{}') as forms,
         coalesce(a.levels, '{}') as levels,
         coalesce(a.stars, '{}') as stars,
         t.card_id as tower, t.form as tower_form,
         t.level as tower_level, t.star_level as tower_star
  from src s
  left join lateral (
    select array_agg(c.card_id order by g.i) as cards,
           array_agg(c.form order by g.i) as forms,
           array_agg(c.level order by g.i) as levels,
           array_agg(c.star_level order by g.i) as stars
    from generate_series(1, s.max_slot) as g(i)
    left join battle_participant_card c
      on c.battle_id = s.battle_id and c.player_tag = s.player_tag
     and c.round = 0 and c.slot = g.i
  ) a on true
  left join battle_participant_card t
    on t.battle_id = s.battle_id and t.player_tag = s.player_tag
   and t.round = 0 and t.slot = 0
  where s.n = s.nd and s.towers <= 1 and s.negative = 0
)
update battle_participant bp
   set cards = b.cards::integer[], card_forms = b.forms::smallint[],
       card_levels = b.levels::smallint[], card_stars = b.stars::smallint[],
       tower_troop_id = b.tower, tower_form = b.tower_form,
       tower_level = b.tower_level, tower_star = b.tower_star
  from built b
 where bp.battle_id = b.battle_id and bp.player_tag = b.player_tag
   and (bp.cards, bp.card_forms, bp.card_levels, bp.card_stars,
        bp.tower_troop_id, bp.tower_form, bp.tower_level, bp.tower_star)
       is distinct from
       (b.cards::integer[], b.forms::smallint[], b.levels::smallint[], b.stars::smallint[],
        b.tower, b.tower_form, b.tower_level, b.tower_star)`;

const ROUND_FILL = `
with k as (
  select distinct r.battle_id, r.player_tag, r.round
  from jsonb_to_recordset($1::jsonb) as r(battle_id text, player_tag text, round smallint)
),
src as (
  select c.battle_id, c.player_tag, c.round,
         max(c.slot) as max_slot,
         count(*) as n,
         count(distinct c.slot) as nd,
         count(*) filter (where c.slot < 1) as below
  from k
  join battle_participant_card c
    on c.battle_id = k.battle_id and c.player_tag = k.player_tag and c.round = k.round
  group by c.battle_id, c.player_tag, c.round
),
built as (
  select s.battle_id, s.player_tag, s.round, a.*
  from src s
  cross join lateral (
    select array_agg(c.card_id order by g.i) as cards,
           array_agg(c.form order by g.i) as forms,
           array_agg(c.level order by g.i) as levels,
           array_agg(c.star_level order by g.i) as stars,
           array_agg(c.used order by g.i) as used
    from generate_series(1, s.max_slot) as g(i)
    left join battle_participant_card c
      on c.battle_id = s.battle_id and c.player_tag = s.player_tag
     and c.round = s.round and c.slot = g.i
  ) a
  where s.n = s.nd and s.below = 0
)
update battle_participant_round r
   set cards = b.cards, card_forms = b.forms, card_levels = b.levels,
       card_stars = b.stars, cards_used = b.used
  from built b
 where r.battle_id = b.battle_id and r.player_tag = b.player_tag and r.round = b.round
   and (r.cards, r.card_forms, r.card_levels, r.card_stars, r.cards_used)
       is distinct from (b.cards, b.forms, b.levels, b.stars, b.used)`;

const DECK_FILL = `
with k as (
  select distinct h as deck_hash from jsonb_array_elements_text($1::jsonb) as h
),
built as (
  select dc.deck_hash,
         array_agg(dc.card_id order by dc.card_id, dc.form) as card_ids,
         array_agg(dc.form order by dc.card_id, dc.form) as card_forms
  from k join deck_card dc on dc.deck_hash = k.deck_hash
  group by dc.deck_hash
)
update deck d
   set card_ids = b.card_ids, card_forms = b.card_forms
  from built b
 where d.deck_hash = b.deck_hash
   and (d.card_ids, d.card_forms) is distinct from (b.card_ids, b.card_forms)`;

/** Fill battle_participant's card arrays and tower columns for
 *  `keys` ([{battle_id, player_tag}]) from their round-0 card rows.
 *  Returns the rows changed. */
export async function fillParticipantArrays(db, keys) {
  if (keys.length === 0) return 0;
  const { rowCount } = await db.query(PARTICIPANT_FILL, [
    keysJson(
      keys.map((k) => ({ battle_id: k.battle_id, player_tag: k.player_tag })),
    ),
  ]);
  return rowCount;
}

/** Fill battle_participant_round's card arrays for `keys`
 *  ([{battle_id, player_tag, round}]) from that round's card rows. */
export async function fillRoundArrays(db, keys) {
  if (keys.length === 0) return 0;
  const { rowCount } = await db.query(ROUND_FILL, [
    keysJson(
      keys.map((k) => ({
        battle_id: k.battle_id,
        player_tag: k.player_tag,
        round: k.round,
      })),
    ),
  ]);
  return rowCount;
}

/** Fill deck.card_ids / card_forms for `hashes` from deck_card. */
export async function fillDeckArrays(db, hashes) {
  if (hashes.length === 0) return 0;
  const { rowCount } = await db.query(DECK_FILL, [
    JSON.stringify([...new Set(hashes)].sort()),
  ]);
  return rowCount;
}
