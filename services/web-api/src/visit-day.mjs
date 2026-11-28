/**
 * The website visit mark (0321, docs/notes/2026-11-28-account-visit-days.md):
 * one account_visit_day row a person a UTC day on which the app's session
 * read, GET /api/me, answered their cookie session. Not a call log: the
 * account and the day, nothing else.
 *
 * GET /api/me is the app's boot read. It runs once when a page of the app
 * opens, again when a tab the person comes back to is a minute stale
 * (the query client's refetch on focus), and after the person changes
 * their session (signing in, a claim, a time zone). Nothing the app does
 * on its own calls it: the feed's poll, the bell and the refreshes read
 * other routes, and the service worker fetches only the push "opened"
 * receipt. So a mark means the person had Elixir in front of them.
 *
 * Cost: a warm instance remembers which (account, day) pairs it already
 * marked, so the insert runs at most once per person per day per
 * instance, and every other request costs nothing. A failed insert is one
 * log line with no account id and never fails or holds the request; the
 * instance does not remember a failed pair, so the next read tries again.
 */

/** Pairs a warm instance remembers before it starts over; a day's worth
 *  of people on one instance is far fewer. */
const REMEMBERED = 10_000;

export function makeVisitMarker({ remembered = REMEMBERED } = {}) {
  let day = null;
  let marked = new Set();
  return async function markVisit(db, accountId, now = Date.now()) {
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== day || marked.size >= remembered) {
      day = today;
      marked = new Set();
    }
    if (marked.has(accountId)) return false;
    try {
      await db.query(
        `insert into account_visit_day (account_id, day) values ($1, $2::date)
         on conflict do nothing`,
        [accountId, today],
      );
      marked.add(accountId);
      return true;
    } catch (error) {
      console.warn({
        at: "visit_mark_failed",
        name: error?.name ?? "Error",
        code: error?.code ?? null,
      });
      return false;
    }
  };
}
