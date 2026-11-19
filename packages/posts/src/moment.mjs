/** The public game achievements a person may attach to their own post.
 * Store the original canonical sentence and identity, never client facts or
 * private Clan/People state. Every delivery reader uses this same shape. */
export const POST_MOMENT_KINDS = Object.freeze([
  "clan_joined",
  "member_joined",
  "member_role_changed",
  "badge_earned",
  "legendary_badge_earned",
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "collection_level_step",
  "career_wins_step",
  "card_unlocked",
  "card_form_unlocked",
  "card_maxed",
  "card_first_win",
  "king_tower_leveled",
  "challenge_best_run",
  "twelve_win_run",
]);
const kinds = new Set(POST_MOMENT_KINDS);
const ID = /^tl_[0-9a-f]{20}$/;
const TAG = /^#[0289PYLQGRJCUV]{3,15}$/;
/** Display eligibility; the server independently re-resolves the record. */
export function postableMoment(item) {
  return Boolean(
    item &&
    kinds.has(item.kind) &&
    item.visibility === "public" &&
    (item.kind !== "member_role_changed" ||
      item.facts?.direction === "promoted") &&
    !["account", "people", "attested"].includes(item.section) &&
    (item.kind !== "arena_changed" || item.facts?.to > item.facts?.from),
  );
}
/** Normalize a stored attachment at the canonical post source. Unknown,
 * malformed and non-game attachments stay out of every output. */
export function readPostMoment(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !ID.test(value.id) ||
    !kinds.has(value.kind) ||
    !TAG.test(value.player_tag) ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    value.text.length > 2000 ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at))
  )
    return null;
  const ref = value.item_ref;
  if (
    !ref ||
    ref.source !== "game" ||
    ref.item_id !== value.id ||
    ref.kind !== value.kind ||
    typeof ref.at !== "string" ||
    !Number.isFinite(Date.parse(ref.at)) ||
    !["player", "clan"].includes(ref.subject?.kind) ||
    !TAG.test(ref.subject?.tag)
  )
    return null;
  return {
    id: value.id,
    kind: value.kind,
    at: value.at,
    player_tag: value.player_tag,
    text: value.text,
    item_ref: {
      item_id: value.id,
      source: "game",
      kind: value.kind,
      at: ref.at,
      subject: { kind: ref.subject.kind, tag: ref.subject.tag },
    },
  };
}
