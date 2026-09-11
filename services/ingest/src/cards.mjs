/**
 * The card catalog and each player's collection, as tables (0076).
 *
 * Both used to be read straight out of the raw payload cache, and the
 * collection silently went missing when that cache became two hours
 * long. A product-facing datum gets a projection; tools never read
 * api_payload. Levels land on the in-game 1-16 scale here, once, the
 * way decks do (contracts displayLevel).
 *
 * Collection events follow the badge rule: the upsert reports what it
 * changed, the first observation of a player is silent (a newly added
 * player arrives with a whole collection, and that is history, not
 * news), and the two things worth a nod get two topics - card_unlocked
 * (a card the player did not have) and card_leveled (a level went up).
 * Counts ticking toward the next level are recorded, never announced.
 */

import { displayLevel } from "@elixir-mcp/contracts";

/** Upsert the catalog: items are cards, supportItems tower troops. A
 *  card never leaves the table; a row is touched only when a field
 *  moved. Returns how many rows were inserted or changed. */
export async function projectCardCatalog(db, { payload, fetchedAt }) {
  const rows = [];
  for (const [kind, list] of [
    ["card", payload?.items],
    ["support", payload?.supportItems],
  ]) {
    for (const c of Array.isArray(list) ? list : []) {
      if (!Number.isInteger(c?.id) || typeof c?.name !== "string") continue;
      rows.push({
        card_id: c.id,
        name: c.name,
        kind,
        rarity: c.rarity ?? null,
        elixir_cost: Number.isInteger(c.elixirCost) ? c.elixirCost : null,
        max_level: Number.isInteger(c.maxLevel) ? c.maxLevel : null,
        max_evolution_level: Number.isInteger(c.maxEvolutionLevel)
          ? c.maxEvolutionLevel
          : null,
        icon_urls: c.iconUrls ?? null,
      });
    }
  }
  if (rows.length === 0) return { changed: 0 };
  rows.sort((a, b) => a.card_id - b.card_id);
  const { rowCount } = await db.query(
    `insert into card (card_id, name, kind, rarity, elixir_cost, max_level, max_evolution_level, icon_urls, first_seen_at, observed_at)
     select r.card_id, r.name, r.kind, r.rarity, r.elixir_cost, r.max_level, r.max_evolution_level, r.icon_urls, $2, $2
     from jsonb_to_recordset($1::jsonb)
       as r(card_id int, name text, kind text, rarity text, elixir_cost int,
            max_level int, max_evolution_level int, icon_urls jsonb)
     on conflict (card_id) do update set
       name = excluded.name, kind = excluded.kind, rarity = excluded.rarity,
       elixir_cost = excluded.elixir_cost, max_level = excluded.max_level,
       max_evolution_level = excluded.max_evolution_level,
       icon_urls = excluded.icon_urls, observed_at = excluded.observed_at
     where card.observed_at < excluded.observed_at
       and (card.name, card.kind, card.rarity, card.elixir_cost, card.max_level,
            card.max_evolution_level, card.icon_urls)
           is distinct from
           (excluded.name, excluded.kind, excluded.rarity, excluded.elixir_cost,
            excluded.max_level, excluded.max_evolution_level, excluded.icon_urls)`,
    [JSON.stringify(rows), fetchedAt],
  );
  return { changed: rowCount };
}

/** Upsert one player's collection from a profile payload; returns the
 *  changed rows and the feed events they earn. */
export async function projectPlayerCards(
  db,
  { playerTag, payload, fetchedAt },
) {
  const rows = [];
  for (const list of [payload?.cards, payload?.supportCards]) {
    for (const c of Array.isArray(list) ? list : []) {
      if (!Number.isInteger(c?.id)) continue;
      rows.push({
        card_id: c.id,
        level:
          typeof c.level === "number" && typeof c.maxLevel === "number"
            ? displayLevel(c.level, c.maxLevel)
            : (c.level ?? null),
        count: Number.isInteger(c.count) ? c.count : null,
        evolution_level: Number.isInteger(c.evolutionLevel)
          ? c.evolutionLevel
          : null,
        star_level: Number.isInteger(c.starLevel) ? c.starLevel : null,
      });
    }
  }
  if (rows.length === 0) return { changed: 0, feedEvents: [] };
  rows.sort((a, b) => a.card_id - b.card_id);
  const { rows: changed } = await db.query(
    `with prior as (
       select card_id, level from player_card where player_tag = $1
     ),
     upserted as (
       insert into player_card (player_tag, card_id, level, count, evolution_level, star_level, first_seen_at, observed_at)
       select $1, r.card_id, r.level, r.count, r.evolution_level, r.star_level, $3::timestamptz, $3::timestamptz
       from jsonb_to_recordset($2::jsonb)
         as r(card_id int, level int, count int, evolution_level int, star_level int)
       on conflict (player_tag, card_id) do update set
         level = excluded.level, count = excluded.count,
         evolution_level = excluded.evolution_level, star_level = excluded.star_level,
         observed_at = excluded.observed_at
       where player_card.observed_at < excluded.observed_at
         and (player_card.level, player_card.count, player_card.evolution_level, player_card.star_level)
             is distinct from
             (excluded.level, excluded.count, excluded.evolution_level, excluded.star_level)
       returning card_id, level
     )
     select u.card_id, u.level as new_level, p.level as prior_level,
            (p.card_id is null) as is_new,
            (select count(*) from prior) as prior_count
       from upserted u left join prior p on p.card_id = u.card_id`,
    [playerTag, JSON.stringify(rows), fetchedAt],
  );
  const feedEvents = [];
  const firstObservation = Number(changed[0]?.prior_count ?? 0) === 0;
  if (!firstObservation) {
    let unlocked = 0;
    let leveled = 0;
    for (const row of changed) {
      if (row.is_new) unlocked += 1;
      else if (
        typeof row.new_level === "number" &&
        typeof row.prior_level === "number" &&
        row.new_level > row.prior_level
      )
        leveled += 1;
    }
    if (unlocked > 0)
      feedEvents.push({
        kind: "player",
        tag: playerTag,
        topic: "card_unlocked",
        count: unlocked,
      });
    if (leveled > 0)
      feedEvents.push({
        kind: "player",
        tag: playerTag,
        topic: "card_leveled",
        count: leveled,
      });
  }
  return { changed: changed.length, feedEvents };
}
