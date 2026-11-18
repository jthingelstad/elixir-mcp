/** The signed-in surfaces decorate the same actual items. Counts and
 * comment permissions stay live; neither is part of a public projection. */
import { withCheers } from "./cheers.mjs";
import { withComments } from "./comments.mjs";
import { timelineItemRef } from "./timeline-item-ref.mjs";

export async function withTimelineSocial(
  db,
  items,
  readerId,
  { comments = false } = {},
) {
  if (!readerId) return items;
  const located = items.map((it) => {
    const ref = timelineItemRef(it);
    return ref ? { ...it, item_ref: ref } : it;
  });
  return withComments(db, await withCheers(db, located, readerId), readerId, {
    enabled: comments,
  });
}
