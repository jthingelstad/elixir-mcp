/**
 * What a bite may not carry. This repo is public and a bite is a tool
 * response copied from a private capture, so the items a reader sees
 * because of who they are stay out of it (review 2026-09-27 §6.4):
 * `attested` (a family app's clan and player facts, some for a clan's
 * members or leaders only) and `account` (the reader's own account).
 * Such an item keeps only what a case can match on: its kind, section,
 * instant and subject.
 */
const PRIVATE_SECTIONS = new Set(["attested", "account"]);
const KEPT = ["kind", "section", "at", "subject_tag"];

const isPrivateItem = (o) =>
  o !== null &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  typeof o.kind === "string" &&
  PRIVATE_SECTIONS.has(o.section);

/** A deep copy with every private item reduced to its stub. */
export function stubPrivate(value) {
  if (Array.isArray(value)) return value.map(stubPrivate);
  if (value === null || typeof value !== "object") return value;
  if (isPrivateItem(value))
    return Object.fromEntries(
      KEPT.filter((k) => k in value).map((k) => [k, value[k]]),
    );
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, stubPrivate(v)]),
  );
}

/** The paths of private items that carry more than their stub. */
export function privateLeaks(value, at = "$") {
  if (Array.isArray(value))
    return value.flatMap((v, i) => privateLeaks(v, `${at}[${i}]`));
  if (value === null || typeof value !== "object") return [];
  if (isPrivateItem(value)) {
    const extra = Object.keys(value).filter((k) => !KEPT.includes(k));
    return extra.length ? [`${at} (${value.kind}: ${extra.join(", ")})`] : [];
  }
  return Object.entries(value).flatMap(([k, v]) =>
    privateLeaks(v, `${at}.${k}`),
  );
}
