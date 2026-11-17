/**
 * The first win with a new card (0289): a player won a battle with a card,
 * an Evolution or Hero form, or a tower troop they did not hold at the
 * profile read before. The owner, 2026-11-17: "In general we were
 * filtering a lot of things that now a timeline would get value from".
 *
 * The rule, decided here (DECISIONS [engineering], 2026-11-17):
 *
 *  - Something new to win with: the record wrote card_unlocked (a card or
 *    a tower troop) or card_form_unlocked (its Evolution or Hero form)
 *    for the player. Those never fire on a player's first profile read,
 *    so a new follow says nothing here either.
 *  - The win: a battle the player won with it in their own deck, played as
 *    that form (a battle's evolutionLevel is the form the slot played as,
 *    cr-agent-api-docs players.md). A plain card counts in any form; its
 *    tower troop counts in the tower slot. Drawn decks (draft, pick,
 *    preset), boat battles and duels never count: the card was not theirs
 *    to bring, or the row carries no deck.
 *  - The first: no earlier win with it in the record since the profile
 *    read before the unlock was seen (the card was not held before then,
 *    so no win with it can be older), and once per player, card and form.
 *  - Fresh: the unlock was seen at most 28 days before the win, and the
 *    battle reached the record within a day of being played; a late
 *    capture never speaks.
 *
 * Either read can come first. A battle log that delivers the win after
 * the profile showed the unlock writes it there (detectFirstWins); a
 * profile that shows the unlock after the log delivered the win writes it
 * from the profile (firstWinsForUnlocks). Stamped at the winning battle;
 * observed at the read that completed it.
 */

import { emitEvent } from "./events.mjs";
import { CARD_FORM_BITS } from "@elixir-mcp/contracts";

const FRESH_DAYS = 28;
const DAY = 24 * 3600_000;
/** As tools' DRAWN_DECKS: the player did not bring their own deck. */
const DRAWN = ["draft", "draftCompetitive", "pick", "predefined", "unknown"];

const FORM_OF_BIT = Object.fromEntries(
  Object.entries(CARD_FORM_BITS).map(([form, bit]) => [bit, form]),
);

/** Does this participant row hold `card_id` as `bit` (null: the card in
 *  any form; a tower troop in the tower slot)? */
export function heldIn(row, { card_id, bit }) {
  if (row.tower_troop_id === card_id)
    return bit === null || ((row.tower_form ?? 0) & bit) !== 0;
  const cards = row.cards ?? [];
  const forms = row.card_forms ?? [];
  for (let i = 0; i < cards.length; i += 1) {
    if (cards[i] !== card_id) continue;
    if (bit === null) return true;
    if (((forms[i] ?? 0) & bit) !== 0) return true;
  }
  return false;
}

/** The player's unlocks (a card or a form), each with the read that saw
 *  it and the profile read before that one (the earliest the card can
 *  have been won with). since bounds how old an unlock may be. */
async function unlocksOf(db, playerTag, since, cardIds = null) {
  const { rows } = await db.query(
    `select e.card_id, e.step as bit, e.window_end as seen_at,
            (select max(s.profile_observed_at) from player_snapshot_daily s
              where s.player_tag = e.player_tag
                and s.profile_observed_at < e.window_end) as held_after
       from player_event e
      where e.player_tag = $1
        and e.event_type in ('card_unlocked', 'card_form_unlocked')
        and e.card_id is not null
        and e.window_end >= $2::timestamptz
        and ($3::int[] is null or e.card_id = any($3::int[]))`,
    [playerTag, since, cardIds],
  );
  return rows.map((r) => ({
    card_id: r.card_id,
    bit: r.bit ?? null,
    seen_at: r.seen_at,
    // No read before: the unlock was not seen against a prior collection,
    // which card_unlocked never is; guard all the same.
    held_after: r.held_after ?? r.seen_at,
  }));
}

/** The player's own-deck wins in a window, oldest first. */
async function winsIn(db, playerTag, from, to) {
  const { rows } = await db.query(
    `select bp.battle_id, bp.battle_time, b.created_at,
            bp.cards, bp.card_forms, bp.tower_troop_id, bp.tower_form
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.player_tag = $1
        and bp.outcome = 'win'
        and bp.type_class = 'pvp'
        and bp.battle_time >= $2::timestamptz
        and bp.battle_time <= $3::timestamptz
        and (b.deck_selection is null or b.deck_selection <> all($4::text[]))
        and (bp.cards is not null or bp.tower_troop_id is not null)
      order by bp.battle_time, bp.battle_id`,
    [playerTag, from, to, DRAWN],
  );
  return rows;
}

async function written(db, playerTag, { card_id, bit }) {
  const { rows } = await db.query(
    `select 1 from player_event
      where player_tag = $1 and event_type = 'card_first_win'
        and card_id = $2 and step is not distinct from $3::int
      limit 1`,
    [playerTag, card_id, bit],
  );
  return rows.length > 0;
}

/** Write the first win for one unlock when the record holds it and it is
 *  fresh; returns 1 when written. */
async function writeFirstWin(
  db,
  { playerTag, unlock, upTo, observedAt, receiptId },
) {
  if (await written(db, playerTag, unlock)) return 0;
  const wins = (await winsIn(db, playerTag, unlock.held_after, upTo)).filter(
    (w) => heldIn(w, unlock),
  );
  const first = wins[0];
  if (!first) return 0;
  const t = first.battle_time.getTime();
  if (first.created_at.getTime() - t > DAY) return 0; // a late capture
  if (unlock.seen_at.getTime() - t > FRESH_DAYS * DAY) return 0;
  if (t - unlock.seen_at.getTime() > FRESH_DAYS * DAY) return 0;
  const { rows: named } = await db.query(
    `select name, rarity, kind from card where card_id = $1`,
    [unlock.card_id],
  );
  const observed = new Date(
    Math.max(Date.parse(observedAt), t, unlock.seen_at.getTime()),
  ).toISOString();
  await emitEvent(db, "card_first_win", {
    tag: playerTag,
    payload: {
      card_id: unlock.card_id,
      name: named[0]?.name ?? null,
      rarity: named[0]?.rarity ?? null,
      tower_troop: named[0]?.kind === "support",
      form: unlock.bit === null ? null : (FORM_OF_BIT[unlock.bit] ?? null),
      battle_id: first.battle_id,
    },
    windowStart: unlock.held_after.toISOString(),
    windowEnd: observed,
    occurredAt: first.battle_time.toISOString(),
    receiptId,
  });
  return 1;
}

/** From a live battle-log read past `mark`: the wins it delivered that
 *  are the first with a card the profile showed new. */
export async function detectFirstWins(
  db,
  { playerTag, mark, observedAt, receiptId = null },
) {
  if (!mark) return { written: 0 };
  const fresh = await winsIn(
    db,
    playerTag,
    new Date(Date.parse(mark) + 1).toISOString(),
    observedAt,
  );
  if (fresh.length === 0) return { written: 0 };
  const ids = new Set();
  for (const w of fresh) {
    for (const c of w.cards ?? []) if (c !== null) ids.add(c);
    if (w.tower_troop_id !== null) ids.add(w.tower_troop_id);
  }
  const since = new Date(
    fresh[0].battle_time.getTime() - FRESH_DAYS * DAY,
  ).toISOString();
  const unlocks = (await unlocksOf(db, playerTag, since, [...ids])).filter(
    (u) => fresh.some((w) => heldIn(w, u)),
  );
  let n = 0;
  for (const unlock of unlocks)
    n += await writeFirstWin(db, {
      playerTag,
      unlock,
      upTo: observedAt,
      observedAt,
      receiptId,
    });
  return { written: n };
}

/** From a profile read that just wrote unlocks: a win the log delivered
 *  before the profile showed the card. */
export async function firstWinsForUnlocks(
  db,
  { playerTag, cardIds, fetchedAt, receiptId = null },
) {
  if (cardIds.length === 0) return { written: 0 };
  const unlocks = (await unlocksOf(db, playerTag, fetchedAt, cardIds)).filter(
    (u) => u.seen_at.getTime() === Date.parse(fetchedAt),
  );
  let n = 0;
  for (const unlock of unlocks)
    n += await writeFirstWin(db, {
      playerTag,
      unlock,
      upTo: fetchedAt,
      observedAt: fetchedAt,
      receiptId,
    });
  return { written: n };
}
