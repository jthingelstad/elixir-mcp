/** Member destinations are source locators, never access grants. No words,
 * names or submitted facts belong in their URLs. The server re-reads the
 * exact canonical item and its current audience on every visit. */
const ITEM_ID = /^tl_[a-f0-9]{20}$/;
const COMMENT_ID = /^[1-9][0-9]{0,18}$/;
const PAGE_ID = /^[a-z0-9]{12}$/i;
const TAG = /^#[0289PYLQGRJCUV]{3,15}$/;

export function timelineItemRef(it) {
  if (!it?.id || it.section === "account") return null;
  const subject =
    it.subjects?.find((s) => s.tag === it.subject_tag) ?? it.subjects?.[0];
  const source =
    it.kind === "post" || it.kind === "battle_highlight"
      ? "post"
      : it.section === "people"
        ? "people"
        : "game";
  return {
    item_id: it.id,
    kind: it.kind,
    source,
    ...(source === "post" ? { post_id: it.post?.id ?? it.facts?.post_id } : {}),
    ...(subject ? { subject: { kind: subject.kind, tag: subject.tag } } : {}),
    ...(source === "people" ? { account: it.facts?.account_id } : {}),
    at: it.facts?.started_at ?? it.sort_at ?? it.at,
  };
}

function locator(input) {
  if (
    !input ||
    !ITEM_ID.test(input.item_id) ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(input.kind)
  )
    return null;
  const ref = {
    item_id: input.item_id,
    kind: input.kind,
    source: input.source,
  };
  if (input.source === "post") {
    if (input.post_id != null) {
      if (!COMMENT_ID.test(String(input.post_id))) return null;
      ref.post_id = String(input.post_id);
    }
  } else if (input.source === "people") {
    if (!PAGE_ID.test(input.account)) return null;
    ref.account = input.account;
  } else if (input.source === "game") {
    if (
      !["player", "clan"].includes(input.subject?.kind) ||
      !TAG.test(input.subject?.tag)
    )
      return null;
    ref.subject = { kind: input.subject.kind, tag: input.subject.tag };
  } else return null;
  if (
    input.at != null &&
    typeof input.at === "string" &&
    Number.isFinite(Date.parse(input.at))
  )
    ref.at = input.at;
  if (input.source !== "post" && !ref.at) return null;
  return ref;
}

export function memberItemPath(
  itemRef,
  { commentId = null, after = null } = {},
) {
  const ref = locator(itemRef);
  if (!ref) return null;
  const query = new URLSearchParams({ ref: JSON.stringify(ref) });
  if (COMMENT_ID.test(String(commentId))) query.set("reply", String(commentId));
  if (
    after === "all" ||
    (typeof after === "string" && Number.isFinite(Date.parse(after)))
  )
    query.set("after", after);
  return `/home/item/${ref.item_id}?${query}`;
}

export function readMemberItemPath(id, search) {
  const raw = search?.ref;
  try {
    const encoded = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (typeof encoded !== "string" || encoded.length > 1500) return null;
    const ref = locator(typeof raw === "string" ? JSON.parse(raw) : raw);
    if (!ref || ref.item_id !== id) return null;
    return {
      ref,
      entry: {
        reply: COMMENT_ID.test(String(search.reply))
          ? String(search.reply)
          : null,
        after:
          search.after === "all" ||
          (typeof search.after === "string" &&
            Number.isFinite(Date.parse(search.after)))
            ? search.after
            : null,
      },
    };
  } catch {
    return null;
  }
}
