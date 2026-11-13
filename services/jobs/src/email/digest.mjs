/** The answer-to-feedback mail's items, told as a digest (#536): the
 *  account's own items for a window, from the same derivation the
 *  timeline serves (`accountWindowItems`), named by their identity
 *  (`keyOf`; null is not news). `digest` drops what the account was
 *  already told, orders the rest and folds it: what leads, and what
 *  rides as a line. The milestone mail composed here too until it
 *  retired (2026-11-12). */
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";

/** The account's own items in a window (#536 stage 2), as the timeline
 *  serves them to the account: the same derivation, story id and
 *  revision. They have no player subject; `subject` names the account. */
export async function accountWindowItems(
  db,
  { accountId, fromMs, toMs, kinds, keyOf },
) {
  const { timeline } = await buildTimeline(db, [], {
    fromMs,
    toMs,
    accountId,
    filter: (it) => kinds.has(it.kind),
  });
  const subject = { tag: null, kind: "account", accountId };
  const found = [];
  for (const it of timeline) {
    const facts = it.facts ?? {};
    const key = keyOf(it.kind, facts);
    if (!key) continue;
    found.push({
      subject,
      kind: it.kind,
      key,
      at: it.at,
      id: it.id,
      revision: it.revision,
      facts,
    });
  }
  return found;
}

/** One told item's identity in a kind's journal: subject, kind, key. */
const toldKey = (m) => `${m.subject.tag}|${m.kind}|${m.key}`;

/** The news in `found` (not in `told`), ordered by `order`, and the
 *  fold: `shown` is what `fold(news)` leads with, `rest` the others in
 *  order. */
export function digest(found, { told, order, fold }) {
  const news = found.filter((m) => !told.has(toldKey(m)));
  news.sort(order);
  const shown = fold(news);
  return { news, shown, rest: news.filter((m) => !shown.includes(m)) };
}
