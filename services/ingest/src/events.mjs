/**
 * Event vocabulary as data — DESIGN §4.5, elixir-bot's event_contracts
 * pattern. A per-event-type code branch is the tell that you're rebuilding
 * what this table replaces. Payloads carry EVIDENCE, not conclusions
 * (§13): roster before/after, observed values — downstream judgment stays
 * possible. Timing honesty: polling is discrete, so most events are
 * 'estimated' with a [window_start, window_end] bracket.
 */

const EVENT_TYPES = {
  member_joined: { stream: "clan", timing: "estimated" },
  member_left: { stream: "clan", timing: "estimated" },
  role_changed: { stream: "clan", timing: "estimated" },
  donation_reset: { stream: "player", timing: "estimated" },
};

const TABLE_BY_STREAM = {
  clan: { table: "clan_event", tagColumn: "clan_tag" },
  player: { table: "player_event", tagColumn: "player_tag" },
};

export async function emitEvent(
  db,
  type,
  { tag, payload, windowStart, windowEnd, receiptId = null },
) {
  const contract = EVENT_TYPES[type];
  if (!contract) throw new Error(`unknown event type: ${type}`);
  const { table, tagColumn } = TABLE_BY_STREAM[contract.stream];
  await db.query(
    `insert into ${table} (${tagColumn}, event_type, timing, window_start, window_end, payload, receipt_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      tag,
      type,
      contract.timing,
      windowStart ?? windowEnd,
      windowEnd,
      JSON.stringify(payload),
      receiptId,
    ],
  );
}
