/**
 * Names enter the record clean. Clash Royale lets a player type colour markup
 * into a name, and the API returns it as typed: `<c2>Name`, `<c9>Na<c5>me`,
 * `<c2>Name<\c>`, `Name<c/>`. In game it is colour; everywhere else it is noise, so it
 * stops here rather than in every reader (Timeline, mail, Discord, MCP,
 * search). The raw payload is archived untouched.
 *
 * Only the colour forms go: a name like `<Ox>~Stoat` or `4<Stoat` is the
 * player's own. A name that is nothing but markup keeps what the player typed
 * rather than becoming no name at all. 0234 and 0235 apply the same rule to the
 * names stored before each form was known, so change them together.
 *
 * Control characters and text-direction overrides go too, here only: they can
 * make a line read in a misleading order, and no name means them. Direction
 * marks (U+200E, U+200F, U+061C), joiners and variation selectors stay, because
 * right-to-left names and emoji need them.
 */
const COLOUR_MARKUP = /<\s*c\d+\s*>|<[\\/]c>|<c\/>/gi;
const CONTROL = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

export function cleanName(name) {
  const text = name.replace(CONTROL, "");
  const cleaned = text.replace(COLOUR_MARKUP, "").trim();
  return cleaned === "" ? text : cleaned;
}

/** Every `name` in a parsed payload, in place: the API's players and clans
 *  are all under that key, at every depth, in every endpoint. */
export function cleanPayloadNames(value) {
  if (Array.isArray(value)) {
    for (const item of value) cleanPayloadNames(item);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "name" && typeof item === "string")
        value.name = cleanName(item);
      else cleanPayloadNames(item);
    }
  }
  return value;
}
