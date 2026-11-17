/**
 * The passport's hooks (#1015): what a successful write earns, asked
 * AFTER that write has committed, never before and never inside its
 * transaction. A write that was refused or failed calls no hook, so it
 * earns nothing.
 *
 * A hook never fails the person's action. Whatever it throws is caught
 * here and written as one log line, `passport_hook_failed` with the
 * hook's name and the error's code (no account, tag, place or words),
 * and the action answers as it would have. The repair:
 *
 *  - every setup Stamp (Player verified, Looking Good, On the Map, Full
 *    Roster, Linked, Mutual, Inner Circle, All Set) and every profile
 *    step is re-derived from what the record holds by the next settle
 *    of that account: the next hook of any kind, or the owner's
 *    `POST /api/me/passport/reconcile`, which Home and the passport
 *    call. A place save is repaired there by asking Clan whether a
 *    place is set now (a boolean, never the place).
 *  - Storyteller is repaired by the same reconciliation, which reads the
 *    account's own posts about battles with words.
 *  - Cheerleader is not repaired: a cheer's "other people's item" test
 *    needs the feed as it was at the tap. A day whose only cheers all
 *    failed their hook is lost; any later accepted cheer that day
 *    counts it. [engineering, 2026-11-14]
 */
import { earnFact, rewindPlayed, settlePassport } from "@elixir-mcp/stamps";

function failed(hook, err) {
  console.error(
    JSON.stringify({
      at: "passport_hook_failed",
      hook,
      error: String(err?.code ?? err?.name ?? "error").slice(0, 40),
    }),
  );
}

/** Settle the account's passport after a successful setup write, with
 *  `latch` (the store's latchProfile patch) when the write proved
 *  something only it can say. Answers the newly granted levels, or []. */
export async function settleAfter(db, accountId, hook, latch = null) {
  if (!accountId) return [];
  try {
    const out = await settlePassport(db, accountId, {
      now: new Date(),
      latch,
    });
    return out.granted ?? [];
  } catch (err) {
    failed(hook, err);
    return [];
  }
}

/** Record a ladder fact with its accepted action. Answers the newly
 *  granted levels, or []. */
export async function factAfter(db, accountId, hook, fact) {
  if (!accountId) return [];
  try {
    const out = await earnFact(db, accountId, fact, { now: new Date() });
    return out.granted ?? [];
  } catch (err) {
    failed(hook, err);
    return [];
  }
}

/** After the account's own or followed players changed: Played Together's
 *  checkpoint is rewound (the battles already read were judged against
 *  the old players), then the account is settled. */
export async function playersChangedAfter(db, accountId, hook) {
  if (!accountId) return [];
  try {
    await rewindPlayed(db, accountId);
  } catch (err) {
    failed(hook, err);
  }
  return settleAfter(db, accountId, hook);
}
