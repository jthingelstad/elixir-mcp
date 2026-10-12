/** Items in a window, told as a digest (#536, stage 1): the one path a
 *  mail kind takes from the timeline's items to what it says.
 *
 *  `windowItems` reads each subject's items for the window from the
 *  same derivation the timeline serves (buildPlayerEntry), keeps the
 *  kinds the mail tells, and names each by its identity (`keyOf`; null
 *  is not news). `digest` drops what the account was already told,
 *  orders the rest and folds it: what leads, and what rides as a line.
 *  A kind supplies its kinds, identity, journal, order and fold; the
 *  words stay the kind's own.
 *
 *  Milestone composes here. Which kinds follow, and what each still
 *  lacks from the timeline, is docs/notes/2026-10-12-w3-spine.md. */
import { buildPlayerEntry } from "@elixir-mcp/tools/activity/entries";

export async function windowItems(
  db,
  { subjects, fromMs, toMs, timezone, kinds, keyOf },
) {
  const found = [];
  for (const subject of subjects) {
    const { items } = await buildPlayerEntry(db, {
      tag: subject.tag,
      relationship: subject.relationship,
      nickname: subject.nickname,
      fromMs,
      toMs,
      timezone,
    });
    for (const it of items) {
      if (!kinds.has(it.kind)) continue;
      const facts = it.facts ?? {};
      const key = keyOf(it.kind, facts);
      if (!key) continue;
      found.push({ subject, kind: it.kind, key, at: it.at, facts });
    }
  }
  return found;
}

/** One told item's identity in a kind's journal: subject, kind, key. */
export const toldKey = (m) => `${m.subject.tag}|${m.kind}|${m.key}`;

/** The news in `found` (not in `told`), ordered by `order`, and the
 *  fold: `shown` is what `fold(news)` leads with, `rest` the others in
 *  order. */
export function digest(found, { told, order, fold }) {
  const news = found.filter((m) => !told.has(toldKey(m)));
  news.sort(order);
  const shown = fold(news);
  return { news, shown, rest: news.filter((m) => !shown.includes(m)) };
}
