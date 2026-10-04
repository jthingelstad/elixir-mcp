/**
 * Event vocabulary as data — DESIGN §4.5, elixir-bot's event_contracts
 * pattern. A per-event-type code branch is the tell that you're rebuilding
 * what this table replaces. Payloads carry EVIDENCE, not conclusions
 * (§13): roster before/after, observed values — downstream judgment stays
 * possible. Timing honesty: polling is discrete, so most events are
 * 'estimated' with a [window_start, window_end] bracket.
 */

import {
  playerEventOriginSql,
  playerEventProofSql,
} from "@elixir-mcp/record/event-origin";

import { playerEventColumns, clanEventColumns } from "./event-columns.mjs";

const EVENT_TYPES = {
  // clan
  member_joined: { stream: "clan", timing: "estimated" },
  member_left: { stream: "clan", timing: "estimated" },
  role_changed: { stream: "clan", timing: "estimated" },
  // The five clans of a new war week, on the record's first sight of them:
  // the bracket is an observation the reader cannot compute; the week's
  // start TIME stays the clock's (game_clock), never a row.
  bracket_observed: { stream: "clan", timing: "estimated" },
  race_finished: { stream: "clan", timing: "exact" },
  week_resolved: { stream: "clan", timing: "estimated" },
  // player (the timeline's named moments, review 2026-09-13 Part IV)
  donation_reset: { stream: "player", timing: "estimated" },
  badge_earned: { stream: "player", timing: "estimated" },
  legendary_badge_earned: { stream: "player", timing: "estimated" },
  arena_changed: { stream: "player", timing: "estimated" },
  ranked_promotion: { stream: "player", timing: "estimated" },
  best_trophies_band: { stream: "player", timing: "estimated" },
  collection_level_step: { stream: "player", timing: "estimated" },
  career_wins_step: { stream: "player", timing: "estimated" },
  card_unlocked: { stream: "player", timing: "estimated" },
  card_leveled: { stream: "player", timing: "estimated" },
  // An Evolution or Hero form newly unlocked (#110, 0192): one per bit.
  card_form_unlocked: { stream: "player", timing: "estimated" },
};

const TABLE_BY_STREAM = {
  clan: { table: "clan_event", tagColumn: "clan_tag" },
  player: { table: "player_event", tagColumn: "player_tag" },
};

export async function emitEvent(
  db,
  type,
  { tag, payload, windowStart, windowEnd, receiptId = null, occurredAt = null },
) {
  const contract = EVENT_TYPES[type];
  if (!contract)
    throw new Error(
      `unknown event type: ${type} (known: ${Object.keys(EVENT_TYPES).join(", ")}) returning event_id`,
    );
  const { table, tagColumn } = TABLE_BY_STREAM[contract.stream];
  // A type is estimated when its emitter normally only knows the window;
  // an emitter that found the instant (the battle that carried a player
  // over an arena's floor) says so by passing it, and the row is exact.
  const timing = occurredAt ? "exact" : contract.timing;
  // The typed columns (0124); one mapping (event-columns.mjs) for the
  // writer and the fill, its inverse in mcp/event-payloads.mjs.
  const columns =
    contract.stream === "player"
      ? playerEventColumns(type, payload)
      : clanEventColumns(type, payload);
  const names = Object.keys(columns);
  const { rows } = await db.query(
    `insert into ${table} (${tagColumn}, event_type, timing, occurred_at, window_start, window_end, receipt_id,
       ${names.join(", ")})
     values ($1, $2, $3, $4, $5, $6, $7, ${names.map((_, i) => `$${8 + i}`).join(", ")}) returning event_id`,
    [
      tag,
      type,
      timing,
      timing === "exact" ? (occurredAt ?? windowEnd) : null,
      windowStart ?? windowEnd,
      windowEnd,
      receiptId,
      ...names.map((n) => columns[n]),
    ],
  );
  if (contract.stream === "player")
    await db.query(
      `with origin as (select w.event_id, ${playerEventOriginSql("w")} as id from player_event w where event_id = $1),
       resolved as (select o.*, p.* from origin o left join lateral (${playerEventProofSql("o.id")}) p on true)
       update player_event w set origin_event_id = r.id,
         evidence_version = coalesce(r.evidence_version, 1),
         evidence_observed_at = coalesce(r.evidence_observed_at, w.window_end),
         battle_id = coalesce(r.battle_id, w.battle_id), floor = coalesce(r.floor, w.floor),
         occurred_at = coalesce(r.occurred_at, w.occurred_at), timing = coalesce(r.timing, w.timing)
         from resolved r where w.event_id = r.event_id`,
      [rows[0].event_id],
    );
}
