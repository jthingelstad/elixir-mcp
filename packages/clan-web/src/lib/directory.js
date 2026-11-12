/**
 * The clan directory's thinking, with no React in it (#768). The tiles come
 * from `/api/clan/directory` already in their order (by name, then tag) and
 * stay in it: a filter only hides tiles, it never reorders them, so nothing
 * here can read as a ranking. Every filter is a fact a tile shows, never a
 * score.
 */
import { CATEGORY_LABELS } from "@elixir-mcp/clan-engine";
import { clanPath } from "./base.js";

/** The game's clan size. A clan under it has room; at it, none. */
export const CLAN_FULL = 50;

export const TYPE_LABELS = {
  open: "Open",
  inviteOnly: "Invite only",
  closed: "Closed",
};

export const WAR_LABELS = {
  participating: "Plays Clan Wars",
  not_participating: "No Clan Wars",
  unknown: "Clan Wars not said",
};

export const POSTURE_LABELS = {
  relaxed: "Relaxed",
  standard: "Standard",
  strict: "Strict",
};

export const FILTERS = {
  war: [
    { key: "any", label: "Any" },
    { key: "participating", label: "Plays" },
    { key: "not_participating", label: "Does not" },
  ],
  posture: [
    { key: "any", label: "Any" },
    { key: "relaxed", label: "Relaxed" },
    { key: "standard", label: "Standard" },
    { key: "strict", label: "Strict" },
  ],
  removal: [
    { key: "any", label: "Any" },
    { key: "none", label: "No removal rule" },
    { key: "14", label: "14 days or more" },
    { key: "30", label: "30 days or more" },
  ],
  room: [
    { key: "any", label: "Any" },
    { key: "room", label: "Has room" },
  ],
};

export const NO_FILTERS = Object.freeze({
  q: "",
  war: "any",
  posture: "any",
  removal: "any",
  room: "any",
  trophies: "",
});

export const isFiltered = (f) =>
  Object.keys(NO_FILTERS).some((k) => String(f[k]).trim() !== NO_FILTERS[k]);

/** A trophies field as a number, or null when it says nothing usable. */
export function trophiesOf(raw) {
  const t = String(raw ?? "").trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  return Number(t);
}

/** Whether one tile fits every filter. An unknown fact never passes a
 *  filter that asks about it: "has room" needs a recorded size. */
export function fits(clan, f) {
  const q = String(f.q ?? "")
    .trim()
    .toLowerCase();
  if (q) {
    const hay = [clan.name, clan.clan_tag, clan.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.war !== "any" && clan.policy.war_intent !== f.war) return false;
  if (f.posture !== "any" && clan.policy.posture !== f.posture) return false;
  if (f.removal === "none" && clan.policy.removal_day !== null) return false;
  if (/^\d+$/.test(f.removal)) {
    const day = clan.policy.removal_day;
    if (day === null || day < Number(f.removal)) return false;
  }
  if (f.room === "room" && !(clan.members !== null && clan.members < CLAN_FULL))
    return false;
  const trophies = trophiesOf(f.trophies);
  if (trophies !== null) {
    if (clan.required_trophies === null) return false;
    if (clan.required_trophies > trophies) return false;
  }
  return true;
}

/** The tiles that fit, in the order they came. */
export const visible = (clans, f) => clans.filter((c) => fits(c, f));

/** What a policy says, as the short facts a tile carries. */
export function policyFacts(policy) {
  const facts = [WAR_LABELS[policy.war_intent] ?? WAR_LABELS.unknown];
  if (policy.posture) facts.push(POSTURE_LABELS[policy.posture]);
  if (policy.together) facts.push("Plays together");
  return facts;
}

/** What counts toward the minimums and Elder, in words. */
export const countedWords = (counted) =>
  counted.map((c) => CATEGORY_LABELS[c] ?? c);

/** The removal rule in a sentence. */
export const removalWords = (day) =>
  day === null
    ? "No removal rule"
    : `A removal comes after ${day} days with no battle`;

/** Where a tile goes: your own clan opens in Clan. Any other has no page
 *  in Elixir (its Explore record went with the Console, 2026-11-12), so its
 *  tile is the whole of it and links nowhere. */
export const tileHref = (clan) => (clan.yours ? clanPath(clan.clan_tag) : null);

/** Two letters for the crest: the name's, else the tag's. */
export function crestOf(clan) {
  const name = (clan.name ?? "").trim();
  if (!name) return clan.clan_tag.replace(/^#/, "").slice(0, 2);
  const words = name.split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words.slice(0, 2).map((w) => Array.from(w)[0])
      : Array.from(words[0]).slice(0, 2);
  return letters.join("").toUpperCase();
}
