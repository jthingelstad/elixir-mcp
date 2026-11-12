import { CONSOLE } from "../lib/console.js";
import { playerHref } from "../lib/player.js";
import { SETTINGS_RAIL } from "../lib/settings.js";
import { HASH_RE, WEEK_RE, normTag, tagPath } from "../lib/tag-url.js";
import { DOC_LINKS } from "./doc-links.js";

/**
 * The search sheet's thinking, with no React in it. What is local (you, your
 * clan's members, people you follow, cards, doc titles, Settings pages) filters
 * on every keystroke. What costs a read (a tag, a name) waits for readSearch,
 * debounced by the sheet.
 *
 * Every player opens their player page (Jamie, 2026-11-12, #764: "Yes, one
 * page"), wherever they were found; the row's right side says who they are to
 * you, or for a searched player their tag, clan and trophies. Ladder and Clan
 * are reached from the page. A clan is found by tag or from your own list,
 * never searched by name across the record. A deck hash or a war week is a
 * lookup of its own: it costs no read here, and Explore opens the record.
 */

const ROLE = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};
/** [engineering, 2026-11-05] The boards draw two or three rows a group. */
const BEFORE_TYPING = 5;
const TYPED = 8;

/** The game's own alphabet: a word outside it is a name, and asking whether it
 *  is a tag would spend two reads on every word. */
const TAG_ALPHABET = /^[0289PYLQGRJCUVO]{3,12}$/;
const NAME_READ_MIN = 3;

export function isTagQuery(q) {
  const t = String(q ?? "").trim();
  if (t.startsWith("#")) return /^#[0-9a-zA-Z]{3,12}$/.test(t);
  return TAG_ALPHABET.test(t.toUpperCase());
}

/** Whether a query is worth a read at all. */
export function readable(q) {
  const t = String(q ?? "").trim();
  return (
    t.length >= NAME_READ_MIN &&
    t.length <= 50 &&
    !HASH_RE.test(t) &&
    !WEEK_RE.test(t)
  );
}

/** What the sheet knows without asking: the session and two cached reads. */
export function searchSources({ me, clans, roster, cards }) {
  const claims = me?.claims ?? [];
  const home = clans?.home_clan ?? null;
  const clanOpen = me?.features?.clan_internal === true;
  const mates = new Map((roster?.members ?? []).map((m) => [m.player_tag, m]));
  return {
    own: claims.filter((c) => c.is_primary || c.relationship === "alt"),
    following: claims.filter((c) => !c.is_primary && c.relationship !== "alt"),
    home,
    clanOpen,
    mates,
    clans: clans?.clans ?? [],
    cards: cards ?? [],
  };
}

const nameOf = (p) => p.nickname ?? p.name ?? p.player_tag;

/** A searched player's row detail: tag, clan and trophies (#764), so two
 *  players with one name can be told apart. */
export function playerDetail(p) {
  const clan = p.clan_name ?? p.clan?.name ?? (p.clan_tag ? p.clan_tag : null);
  return [
    p.player_tag,
    clan ?? "No clan",
    p.trophies != null
      ? `${Number(p.trophies).toLocaleString("en-US")} trophies`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The one door for a player, whichever way they were found: their player
 *  page. `detail` is what the row says on its right when the player is
 *  nobody to you. */
export function doorFor(tag, s, name = tag, detail = null) {
  const href = playerHref(tag);
  if (s.own.some((c) => c.player_tag === tag))
    return { t: name, d: "You", href };
  const mate = s.mates.get(tag);
  if (mate && s.home)
    return {
      t: name,
      d: s.home.name ?? "Clan",
      role: ROLE[mate.role] ?? null,
      href,
    };
  if (s.following.some((c) => c.player_tag === tag))
    return { t: name, d: detail ?? "Following", href };
  return { t: name, d: detail ?? tag, href };
}

function clanRow(clan, s, name = clan.name ?? clan.clan_tag) {
  const mine = s.clanOpen && s.home?.clan_tag === clan.clan_tag;
  return mine
    ? { t: name, d: "Clan", href: `/clan/${tagPath(clan.clan_tag)}` }
    : {
        t: name,
        d: "Record",
        href: `${CONSOLE}/explore/clan/${tagPath(clan.clan_tag)}`,
      };
}

function people(s) {
  const you = s.own.map((c) => doorFor(c.player_tag, s, nameOf(c)));
  const mine = new Set(s.own.map((c) => c.player_tag));
  const mates = [...s.mates.values()]
    .filter((m) => !mine.has(m.player_tag))
    .map((m) => ({
      match: `${m.name ?? ""} ${m.player_tag}`,
      ...doorFor(m.player_tag, s, m.name ?? m.player_tag),
    }));
  // A clanmate you also follow is listed once, as a clanmate.
  const following = s.following
    .filter((c) => !s.mates.has(c.player_tag))
    .map((c) => ({
      match: `${c.nickname ?? ""} ${c.name ?? ""} ${c.player_tag}`,
      ...doorFor(c.player_tag, s, nameOf(c)),
    }));
  const clans = [
    ...(s.home?.clan_tag ? [s.home] : []),
    ...s.clans.filter((c) => c.clan_tag !== s.home?.clan_tag),
  ].map((c) => ({
    match: `${c.name ?? ""} ${c.clan_tag}`,
    ...clanRow(c, s),
  }));
  return { you, mates, following, clans };
}

const group = (h, rows, cap) =>
  rows.length ? { h, rows: rows.slice(0, cap) } : null;

/** [engineering, 2026-11-06] Explore has no other door from the app. */
const EXPLORE_LOOKUP = {
  t: "Look up a tag, deck or war week",
  d: "Explore",
  href: `${CONSOLE}/explore`,
};
const MEANS_LOOKUP = /look|explor|deck|hash|\bwar\b|week/;

/** [engineering, 2026-11-12] The clan directory's door from search (#768),
 *  until the Find tab carries it: a clan is found there by its rules. */
const CLAN_DIRECTORY = {
  t: "Clan directory",
  d: "Find a clan",
  href: "/clan/directory",
};
const MEANS_DIRECTORY = /director|find|join|recruit|clans?\b/;

/** A typed deck hash or war week, opened as Explore's lookup opens it: a week
 *  on its own names the home clan's race, and with no home clan the lookup is
 *  where to say which. */
function lookupRows(raw, s) {
  const t = String(raw ?? "").trim();
  if (HASH_RE.test(t)) {
    const hash = t.replace(/^deck:/i, "").toLowerCase();
    return [
      {
        t: `Deck ${hash.slice(0, 12)}…`,
        d: "Record",
        href: `${CONSOLE}/explore/deck/${hash}`,
      },
    ];
  }
  const week = WEEK_RE.exec(t);
  if (!week) return [];
  if (!s.home?.clan_tag) return [EXPLORE_LOOKUP];
  const season = Number(week[1]);
  const section = Number(week[2]) - 1;
  return [
    {
      t: `Season ${season}, week ${section + 1}`,
      d: s.home.name ?? "Your clan",
      href: `${CONSOLE}/explore/week/${tagPath(s.home.clan_tag)}~${season}~${section}`,
    },
  ];
}

/** The sheet before a key is pressed. */
export function beforeTyping(s) {
  const { you, mates, following, clans } = people(s);
  return [
    group("You", you, BEFORE_TYPING),
    group("Clanmates", mates, BEFORE_TYPING),
    group("People you follow", following, BEFORE_TYPING),
    group("Clans", clans, BEFORE_TYPING),
    group("Look up", [EXPLORE_LOOKUP, CLAN_DIRECTORY], BEFORE_TYPING),
  ].filter(Boolean);
}

/** Every Docs title once, in reading order. */
const DOC_TITLES = (() => {
  const seen = new Map();
  for (const [, links] of Object.values(DOC_LINKS))
    for (const [t, href] of links)
      if (!seen.has(href)) seen.set(href, { t, d: "Docs", href, plain: true });
  return [...seen.values()];
})();

const SETTINGS_PAGES = SETTINGS_RAIL.map((r) => ({
  t: r.label,
  d: "Settings",
  href: r.to,
}));

const hits = (q) => (text) =>
  String(text ?? "")
    .toLowerCase()
    .includes(q);

/** The local half of a typed word, grouped. `found` is what readSearch returned
 *  for it, merged in by door so a name is never drawn twice. */
export function typedGroups(raw, s, found = null) {
  const q = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!q) return beforeTyping(s);
  const match = hits(q);
  const { you, mates, following, clans } = people(s);
  const youRows = you.filter(
    (r, i) => match(r.t) || match(s.own[i]?.player_tag),
  );
  const mateRows = mates
    .filter((r) => match(r.match))
    .map((r) => ({
      ...r,
      d: r.role ? `${r.d}, ${r.role}` : r.d,
    }));
  const followRows = following.filter((r) => match(r.match));
  const seen = new Set(
    [...youRows, ...mateRows, ...followRows].map((r) => r.href),
  );
  const lookup = lookupRows(raw, s);
  const fresh = [];
  for (const p of found?.players ?? []) {
    const label = p.label ?? nameOf(p);
    const row = doorFor(p.player_tag, s, label, playerDetail(p));
    if (seen.has(row.href)) continue;
    seen.add(row.href);
    fresh.push(row);
  }
  const foundClans = (found?.clans ?? []).map((c) =>
    clanRow(c, s, `${c.name ?? c.clan_tag} ${c.clan_tag}`),
  );
  const clanRows = clans.filter(
    (r) => match(r.match) && !foundClans.some((c) => c.href === r.href),
  );
  return [
    group("Look up", lookup, TYPED),
    group("You", youRows, TYPED),
    group("Clanmates", mateRows, TYPED),
    group("People you follow", followRows, TYPED),
    group("Players", fresh, TYPED),
    group("Clans", [...foundClans, ...clanRows], TYPED),
    group(
      "Cards",
      s.cards
        .filter((c) => match(c.name))
        .map((c) => ({
          t: c.name,
          d: "Card",
          href: `/cards/${c.id}`,
          plain: true,
        })),
      TYPED,
    ),
    group(
      "Docs",
      DOC_TITLES.filter((r) => match(r.t)),
      TYPED,
    ),
    group(
      "Settings",
      SETTINGS_PAGES.filter((r) => match(r.t)),
      TYPED,
    ),
    lookup.length
      ? null
      : group(
          "Look up",
          [
            ...(MEANS_LOOKUP.test(q) ? [EXPLORE_LOOKUP] : []),
            ...(MEANS_DIRECTORY.test(q) ? [CLAN_DIRECTORY] : []),
          ],
          TYPED,
        ),
  ].filter(Boolean);
}

const REFUSED = new Set([
  "quota_exceeded",
  "rate_limited",
  "internal",
  "timeout",
  "upstream_unavailable",
]);
const SEARCH_FAILED = "Elixir did not answer just now; try again in a moment.";

/** A read that failed is said as what it is, never as "no record". */
function failure(r) {
  if (!r.ok) return r.data?.message ?? SEARCH_FAILED;
  const err = r.data?.is_error ? r.data.body?.error : null;
  return err && REFUSED.has(err.code) ? (err.message ?? SEARCH_FAILED) : null;
}

/**
 * The read half: a tag asks for the player, then the clan, then names; a word
 * asks for names. `explore(tool, args)` is the bridge, `seen(kind, id, tool,
 * args, body)` keeps a found record so opening it costs no second read.
 * Throws with the message when Elixir did not answer.
 */
export async function readSearch(raw, explore, seen = () => {}) {
  const query = String(raw ?? "").trim();
  const asTag = isTagQuery(query);
  const empty = { players: [], clans: [], miss: null };
  const ask = async (tool, args) => {
    const r = await explore(tool, args);
    const failed = failure(r);
    if (failed) throw new Error(failed);
    return r.data.is_error ? null : r.data.body;
  };
  if (asTag) {
    const tag = normTag(query);
    const id = tagPath(tag);
    const player = await ask("players_summary", { player_tag: tag });
    if (player) {
      seen("player", id, "players_summary", { player_tag: id }, player);
      const name = player.nickname ?? player.name;
      return {
        ...empty,
        players: [
          {
            player_tag: tag,
            label: name ?? tag,
            clan_name: player.clan?.name ?? null,
            clan_tag: player.clan?.clan_tag ?? null,
            trophies: player.trophies ?? null,
          },
        ],
      };
    }
    const clan = await ask("clans_roster", { clan_tag: tag });
    if (clan) {
      seen("clan", id, "clans_roster", { clan_tag: id }, clan);
      return { ...empty, clans: [{ clan_tag: tag, name: clan.name }] };
    }
    if (query.startsWith("#")) return { ...empty, miss: tag };
    // Spelled like a tag, and maybe a name all along.
    const named = await ask("players_search", { query, limit: 8 });
    const matches = named?.matches ?? [];
    return matches.length
      ? { ...empty, players: matches }
      : { ...empty, miss: tag };
  }
  const named = await ask("players_search", { query, limit: 8 });
  return { ...empty, players: named?.matches ?? [] };
}
