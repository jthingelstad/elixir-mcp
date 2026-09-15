/**
 * The played-card projections (0091): census and diagnostics.
 *
 *   {deck_census: true}
 *     Read-only: participants whose deck_hash has no deck row or no
 *     played rows, collection rows without a catalog card, stub cards the
 *     catalog has not yet confirmed. All zero is the gate for the closing
 *     FKs.
 *
 *   {explain_meta: {clan_tag?, days?}}
 *     EXPLAIN (ANALYZE, BUFFERS) of a clan-scoped meta call's pieces.
 *
 *   {rewrite_table: "battle_participant"}
 *     VACUUM FULL one named table - the space a dropped column (0097)
 *     held comes back only with a rewrite, and a rewrite takes an
 *     exclusive lock for its duration, so it is a deliberate op, never a
 *     migration. Collector submits block and retry meanwhile.
 *
 * The one-time backfill from the deck JSON (deck_backfill, deck_forms)
 * ran on 2026-09-15 (454,654 participants, 90 batches) and left with the
 * column in 0097; tests seed the rows directly (mcp/test/deck-rows.mjs).
 */

import pg from "pg";

const REWRITABLE = new Set([
  "battle_participant",
  "battle_participant_card",
  "deck_card",
]);

export async function rewriteTable(databaseUrl, spec) {
  const table = String(spec?.table ?? spec ?? "");
  if (!REWRITABLE.has(table))
    throw new Error(`rewrite_table: not one of ${[...REWRITABLE].join(", ")}`);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const size = async () =>
      (
        await db.query(
          `select pg_total_relation_size($1)::bigint as bytes, pg_relation_size($1)::bigint as heap`,
          [table],
        )
      ).rows[0];
    const before = await size();
    const started = Date.now();
    await db.query(`vacuum (full, analyze) ${table}`);
    const after = await size();
    return { table, ms: Date.now() - started, before, after };
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
           where bp.deck_hash is not null
             and not exists (select 1 from battle_participant_card c
                              where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag)) as participants_without_played_rows,
         (select count(*)::int from player_card pc
           where not exists (select 1 from card c where c.card_id = pc.card_id)) as collection_rows_without_card,
         (select count(*)::int from card where catalog_seen_at is null) as stub_cards,
         (select count(*)::int from deck) as decks,
         (select count(*)::int from deck_card) as deck_cards,
         (select count(*)::int from battle_participant_card) as played_rows,
         (select count(*)::int from battle_participant where deck_hash is not null) as participants_with_deck`,
    );
    return r;
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
