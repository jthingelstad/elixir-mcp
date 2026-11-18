/** A public projection, never a serialized signed-in feed response.
 * New/unknown kinds fail closed until their source schema is declared.
 * All attested Clan state stays signed-in, regardless of who shared it.
 */
import { readPostMoment } from "@elixir-mcp/posts/moment";
import { ATTESTED_FACT_TYPES } from "@elixir-mcp/contracts";
import { TIMELINE_KIND_SCHEMAS } from "@elixir-mcp/tools/activity/schemas";

const PEOPLE = new Set(["player_verified", "stamp_earned", "place_set"]);
const PRIVATE =
  /nickname|email|account|passport|comment|cheer|following|location|latitude|longitude|hold|note|secret|token|report|moderation|can_/i;
const pick = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => value?.[key] !== undefined)
      .map((key) => [key, clean(value[key])]),
  );
function clean(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PRIVATE.test(key))
        .map(([key, v]) => [key, clean(v)]),
    );
  return value;
}
export function shareableItem(it) {
  if (
    !it ||
    typeof it.kind !== "string" ||
    !/^tl_[0-9a-f]{20}$/.test(String(it.id ?? ""))
  )
    return false;
  if (
    it.section === "account" ||
    it.section === "attested" ||
    Object.hasOwn(ATTESTED_FACT_TYPES, it.kind)
  )
    return false;
  if (
    it.kind === "account" ||
    it.kind?.startsWith("account_") ||
    it.kind === "battle_highlight"
  )
    return false;
  if (it.kind === "battle")
    return it.visibility === "public" && Boolean(it.battle?.id);
  if (it.kind === "post") return Boolean(it.post) && !it.post.status;
  if (it.section === "account" || it.section === "attested") return false;
  if (it.section === "people") return PEOPLE.has(it.kind);
  return (
    it.visibility === "public" && Object.hasOwn(TIMELINE_KIND_SCHEMAS, it.kind)
  );
}
export function publicItem(it) {
  if (!shareableItem(it)) return null;
  const out = pick(it, [
    "id",
    "kind",
    "section",
    "at",
    "sort_at",
    "observed_at",
    "revision",
    "spark",
    "scores",
    "text",
    "subject_tag",
    "subject_name",
    "avatar_card_id",
    "deck",
    "moment_card",
    "moment_cards",
    "badge_art",
  ]);
  out.subjects = (it.subjects ?? []).map((s) =>
    pick(s, ["kind", "tag", "name"]),
  );
  if (it.kind === "battle") {
    Object.assign(out, pick(it, ["battle", "sides", "games", "score"]));
    delete out.battle.url;
    delete out.battle.image;
  } else if (it.kind === "post") {
    out.post = pick(it.post, [
      "text",
      "question",
      "deck",
      "cards",
      "battle",
      "versus",
      "edited",
    ]);
    // Links to a battle or another record are member destinations, never
    // an anonymous way to walk beyond this one item.
    out.post.moment = readPostMoment(it.post.moment);
    out.post.author = pick(it.post.author, ["player_tag", "name"]);
    if (out.post.battle) delete out.post.battle.url;
  } else if (it.section === "people") {
    out.facts = pick(it.facts, ["player_tag", "name", "relationship"]);
    if (it.kind === "stamp_earned")
      out.facts.stamps = (it.facts?.stamps ?? []).map((s) =>
        pick(s, ["id", "stamp_id", "name", "title", "level", "icon"]),
      );
  } else {
    const schema = TIMELINE_KIND_SCHEMAS[it.kind];
    out.facts = pick(it.facts, [...schema.facts, ...(schema.optional ?? [])]);
  }
  return out;
}
