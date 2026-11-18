/** A bounded source locator, never submitted facts or permission. Every
 * action resolves the identity from its current source before using it. */
export function timelineItemRef(it) {
  if (!it?.id || it.section === "account") return null;
  const subject =
    it.subjects?.find((s) => s.tag === it.subject_tag) ?? it.subjects?.[0];
  return {
    item_id: it.id,
    kind: it.kind,
    source:
      it.kind === "post" || it.kind === "battle_highlight"
        ? "post"
        : it.section === "people"
          ? "people"
          : "game",
    ...(it.kind === "post" || it.kind === "battle_highlight"
      ? { post_id: it.post?.id ?? it.facts?.post_id }
      : {}),
    ...(subject ? { subject: { kind: subject.kind, tag: subject.tag } } : {}),
    ...(it.section === "people" ? { account: it.facts?.account_id } : {}),
    at: it.facts?.started_at ?? it.sort_at ?? it.at,
  };
}

export function readItemRef(raw) {
  if (typeof raw !== "string" || raw.length > 1500) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}
