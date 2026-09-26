/**
 * {duel_round_decks} (0182, feedback #363): fills a duel round's deck and
 * result for the rounds recorded before ingest stamped them. A round's
 * cards are already in battle_participant_card (round > 0) and its crowns
 * in battle_participant_round (0151); this writes the round's deck_hash
 * (its eight cards, no tower troop: the identity a Clan Wars battle has),
 * the deck and deck_card rows beside it, and the round's outcome by its
 * crowns against the opponent's same round.
 *
 * The migration skill's anatomy: keyset on the primary key, a batch a
 * transaction, only rows still null, a 45 s budget, a cursor passed back
 * until `done`, a deadlock retried. A round whose cards are not all
 * recorded, or whose crowns are missing on a side, stays null and is
 * counted, never retried forever. Rows only: no event, no moment.
 */

import pg from "pg";
import { deckHash } from "@elixir-mcp/contracts";
import { loadVocabulary, stampDecks } from "../../ingest/src/card-roles.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function duelRoundDecks(
  databaseUrl,
  { after = null, batch = 200, budget_s = 45, max_batches = Infinity } = {},
) {
  // Like {series_backfill}: 45 s by default, up to 280 when asked.
  const budget = Math.min(Math.max(Number(budget_s), 5), 280) * 1000;
  const size = Math.min(Math.max(Number(batch), 1), 1000);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  let cursor = Array.isArray(after) && after.length === 3 ? after : null;
  let batches = 0;
  let decksFilled = 0;
  let outcomesFilled = 0;
  let done = false;
  try {
    const vocab = await loadVocabulary(db);
    while (Date.now() - started < budget && batches < max_batches) {
      const { rows } = await db.query(
        // The batch's keys first, on the primary key; each round's cards
        // are then one index probe apiece, never an aggregate over the table.
        `with k as (
           select battle_id, player_tag, round, deck_hash
             from battle_participant_round
            where (deck_hash is null or outcome is null)
              and ($1::text is null
                   or (battle_id, player_tag, round)
                      > ($1::text, $2::text, $3::smallint))
            order by battle_id, player_tag, round
            limit $4
         )
         select k.battle_id, k.player_tag, k.round, bp.battle_time,
                k.deck_hash is null as needs_deck,
                (select array_agg(c.card_id || ':' || c.form order by c.slot)
                   from battle_participant_card c
                  where c.battle_id = k.battle_id and c.player_tag = k.player_tag
                    and c.round = k.round and c.slot > 0) as pairs
           from k
           join battle_participant bp
             on bp.battle_id = k.battle_id and bp.player_tag = k.player_tag
          order by k.battle_id, k.player_tag, k.round`,
        [cursor?.[0] ?? null, cursor?.[1] ?? null, cursor?.[2] ?? null, size],
      );
      if (rows.length === 0) {
        done = true;
        break;
      }
      const decks = new Map();
      const stamps = [];
      for (const r of rows) {
        if (!r.needs_deck) continue;
        const pairs = (r.pairs ?? []).map((p) => p.split(":").map(Number));
        if (pairs.length !== 8) continue;
        const hash = deckHash({
          cards: pairs.map(([id, form]) => ({ id, evolutionLevel: form })),
        });
        stamps.push({
          battle_id: r.battle_id,
          player_tag: r.player_tag,
          round: r.round,
          deck_hash: hash,
        });
        const at = r.battle_time.toISOString();
        const d = decks.get(hash);
        if (!d)
          decks.set(hash, {
            deck_hash: hash,
            first_seen_at: at,
            last_seen_at: at,
            cards: pairs.map(([card_id, form]) => ({ card_id, form })),
          });
        else {
          if (at < d.first_seen_at) d.first_seen_at = at;
          if (at > d.last_seen_at) d.last_seen_at = at;
        }
      }
      const keys = {
        ids: rows.map((r) => r.battle_id),
        tags: rows.map((r) => r.player_tag),
        rounds: rows.map((r) => r.round),
      };
      for (let attempt = 1; ; attempt++) {
        try {
          await db.query("begin");
          const deckRows = [...decks.values()].sort((a, z) =>
            a.deck_hash < z.deck_hash ? -1 : 1,
          );
          if (deckRows.length) {
            await db.query(
              `insert into deck (deck_hash, tower_troop_id, card_count, first_seen_at, last_seen_at)
               select r.deck_hash, null, 8, r.first_seen_at, r.last_seen_at
                 from jsonb_to_recordset($1::jsonb)
                   as r(deck_hash text, first_seen_at timestamptz, last_seen_at timestamptz)
               on conflict (deck_hash) do update set
                 first_seen_at = least(deck.first_seen_at, excluded.first_seen_at),
                 last_seen_at = greatest(deck.last_seen_at, excluded.last_seen_at)
               where deck.first_seen_at > excluded.first_seen_at
                  or deck.last_seen_at < excluded.last_seen_at`,
              [JSON.stringify(deckRows.map(({ cards: _c, ...d }) => d))],
            );
            await db.query(
              `insert into deck_card (deck_hash, card_id, form)
               select r.deck_hash, r.card_id, r.form
                 from jsonb_to_recordset($1::jsonb)
                   as r(deck_hash text, card_id int, form smallint)
               on conflict do nothing`,
              [
                JSON.stringify(
                  deckRows.flatMap((d) =>
                    d.cards.map((c) => ({ deck_hash: d.deck_hash, ...c })),
                  ),
                ),
              ],
            );
          }
          const filled = stamps.length
            ? await db.query(
                `update battle_participant_round r
                    set deck_hash = s.deck_hash
                   from jsonb_to_recordset($1::jsonb)
                     as s(battle_id text, player_tag text, round smallint, deck_hash text)
                  where r.battle_id = s.battle_id and r.player_tag = s.player_tag
                    and r.round = s.round and r.deck_hash is null`,
                [JSON.stringify(stamps)],
              )
            : { rowCount: 0 };
          // The result by this round's crowns against the other side's
          // same round (a duel is one player a side).
          const outcomes = await db.query(
            `update battle_participant_round r
                set outcome = case when r.crowns > o.crowns then 'win'
                                   when r.crowns < o.crowns then 'loss'
                                   else 'draw' end
               from unnest($1::text[], $2::text[], $3::smallint[]) as k(battle_id, player_tag, round),
                    battle_participant bp, battle_participant op,
                    battle_participant_round o
              where r.battle_id = k.battle_id and r.player_tag = k.player_tag
                and r.round = k.round and r.outcome is null
                and bp.battle_id = r.battle_id and bp.player_tag = r.player_tag
                and op.battle_id = r.battle_id and op.side <> bp.side
                and o.battle_id = op.battle_id and o.player_tag = op.player_tag
                and o.round = r.round
                and r.crowns is not null and o.crowns is not null`,
            [keys.ids, keys.tags, keys.rounds],
          );
          await db.query("commit");
          decksFilled += filled.rowCount;
          outcomesFilled += outcomes.rowCount;
          break;
        } catch (e) {
          await db.query("rollback").catch(() => {});
          if (e?.code === "40P01" && attempt < 4) {
            await pause(250 * attempt);
            continue;
          }
          throw e;
        }
      }
      // A new deck is named the moment it exists, as ingest does.
      if (decks.size)
        await stampDecks(db, vocab, { hashes: [...decks.keys()] });
      const last = rows[rows.length - 1];
      cursor = [last.battle_id, last.player_tag, last.round];
      batches += 1;
      if (rows.length < size) {
        done = true;
        break;
      }
    }
    // Whatever is still null behind the cursor could not be filled (a
    // round without all eight cards, or a side without its crowns); ahead
    // of it is what the next call does.
    const {
      rows: [left],
    } = await db.query(
      `select count(*) filter (where deck_hash is null)::int as decks,
              count(*) filter (where outcome is null)::int as outcomes,
              count(*) filter (where ($1::text is null
                  or (battle_id, player_tag, round) > ($1::text, $2::text, $3::smallint))
                and (deck_hash is null or outcome is null))::int as ahead
         from battle_participant_round`,
      [cursor?.[0] ?? null, cursor?.[1] ?? null, cursor?.[2] ?? null],
    );
    return {
      batches,
      decks_filled: decksFilled,
      outcomes_filled: outcomesFilled,
      after: cursor,
      done,
      remaining: done ? 0 : left.ahead,
      still_null: { decks: left.decks, outcomes: left.outcomes },
      ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}
