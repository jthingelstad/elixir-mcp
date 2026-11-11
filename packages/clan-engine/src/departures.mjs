/**
 * Departures: which member_left events the record shows that this ledger
 * has not yet explained, for a clan whose policy asks about departures. A
 * leave and a kick look identical in the roster diff, and the ledger is
 * the only place the difference can be recorded, so a leader is asked:
 * Kicked, Left, or Ignore.
 *
 * A departure already explained by a removal card marked Done before it
 * (the card's outcome verification records member_kicked) raises nothing.
 * One card per (tag, observed leave); a rejoin and a second leave is a
 * second card. A leave the member has already undone (they rejoined, or
 * they are on the current roster) raises nothing.
 *
 * A leave while the member's removal Action was still open (a leader
 * kicked them before marking it Done, and the next run withdrew it
 * because they were gone) still asks, because only a leader's word says
 * kick (Jamie, 2026-11-10: "Elixir Clan links a departure to an open
 * removal Action and preselects Kicked"). The departure names that
 * removal and suggests Kicked; it never records one.
 */

const DAY_MS = 86400_000;

/** Why an open Action about someone who left is withdrawn (evaluate.mjs
 *  reconcileCards); withdrawals since 2026-11-10 also carry
 *  `withdraw_detail.left_clan`. */
export const LEFT_CLAN_REASON = "They are no longer in the clan.";

/**
 * The removal Action that was still open when a member left: raised
 * before the leave, and still proposed or withdrawn by the leave itself.
 * The latest such one, or null. A removal marked Done explains the leave
 * instead (departuresFrom), and one withdrawn for any other reason (they
 * played, a hold, a decline's wait) was not open at the leave.
 */
export function openRemovalAtLeave(cards, tag, leftAt) {
  const atMs = Date.parse(leftAt);
  const closedByLeave = (c) =>
    c.status === "withdrawn" &&
    (c.withdraw_detail?.left_clan === true ||
      c.withdraw_reason === LEFT_CLAN_REASON) &&
    Date.parse(c.withdrawn_at) >= atMs - DAY_MS;
  const found = (cards ?? [])
    .filter(
      (c) =>
        c.type === "removal" &&
        c.player_tag === tag &&
        Date.parse(c.raised_at) <= atMs &&
        (c.status === "proposed" || closedByLeave(c)),
    )
    .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1));
  return found[0] ?? null;
}

/** The departure's line about the removal it follows. */
export const removalLinkLine = (number) =>
  Number.isInteger(number)
    ? `Elixir recommended removing them in Action #${number}.`
    : "Elixir recommended removing them.";

/**
 * @param {Array<{type:string, at:string, detail:object}>} events the roster's recent_events
 * @param {Array} cards the ledger's cards
 * @param {Map<string, object>} [lastKnown] tag → the last verdict line seen for the member
 */
export function departuresFrom(
  events,
  cards,
  lastKnown = new Map(),
  currentTags = null,
) {
  // A member who came back is not a departure to classify (overnight walk
  // 2026-09-24: alex left and rejoined the same evening and the inbox
  // still asked Kicked / Left / Ignore; Kicked would write a false kick).
  const rejoined = (tag, atMs) =>
    (currentTags && currentTags.has(tag)) ||
    (events ?? []).some(
      (e) =>
        e.type === "member_joined" &&
        e.detail?.player_tag === tag &&
        Date.parse(e.at) > atMs,
    );
  const explained = (tag, atMs) =>
    cards.some(
      (c) =>
        c.player_tag === tag &&
        ((c.type === "departure" &&
          c.evidence?.left_at &&
          Math.abs(Date.parse(c.evidence.left_at) - atMs) < DAY_MS) ||
          (c.type === "removal" &&
            c.status === "done" &&
            c.decided_at &&
            Date.parse(c.decided_at) <= atMs + DAY_MS)),
    );
  return (events ?? [])
    .filter((e) => e.type === "member_left" && e.detail?.player_tag)
    .map((e) => ({
      player_tag: e.detail.player_tag,
      player_name: e.detail.name ?? null,
      left_at: e.at,
      // Elixir's roster event stamps the departing role as
      // role_at_departure; `role` is the feed's spelling.
      role_before: e.detail.role_at_departure ?? e.detail.role ?? null,
      last: lastKnown.get(e.detail.player_tag) ?? null,
    }))
    .filter((d) => !explained(d.player_tag, Date.parse(d.left_at)))
    .filter((d) => !rejoined(d.player_tag, Date.parse(d.left_at)))
    .map((d) => {
      const removal = openRemovalAtLeave(cards, d.player_tag, d.left_at);
      return {
        ...d,
        removal: removal
          ? {
              card_id: removal.card_id,
              number: Number.isInteger(removal.number) ? removal.number : null,
            }
          : null,
        // The answer offered first; the leader still chooses.
        suggested: removal ? "kick" : null,
      };
    });
}

export const DEPARTURE_CLASSIFICATIONS = ["kick", "leave", "ignore"];
