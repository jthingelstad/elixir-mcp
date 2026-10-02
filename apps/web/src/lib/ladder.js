/**
 * Ladder: your season, read back (design canvas, 2026-10-01). A section
 * of Elixir itself at /ladder, beside the Console in the same app and
 * the same shell, with its own rail (placement decided 2026-09-28).
 *
 * Everything on a Ladder page is a fact a tool returned: the record
 * over the season, in one mode at a time. Ladder never computes a
 * verdict, a pace or a coaching line (docs/DECISIONS.md: facts, never
 * judgments; no branded or derived player metric). The functions here
 * route and shape; they never rate.
 *
 * MODES ARE DIFFERENT GAMES. Every read passes one `mode`, and nothing
 * on a page pools across modes: Trophy Road and Path of Legends match
 * by different rules, and war draws opponents from the racing clans.
 */
import { tagPath } from "./tag-url.js";

export const LADDER = "/ladder";

/** The pages, in rail order. `slug` "season" is the bare /ladder. */
export const LADDER_PAGES = [
  { slug: "season", label: "Season", icon: "chart-line" },
];

/** The mode groups a Ladder page reads, one at a time, in tab order.
 *  `key` is the tools' `mode` argument. */
export const MODES = [
  { key: "ladder", label: "Trophy Road" },
  { key: "ranked", label: "Path of Legends" },
  { key: "war", label: "War" },
  { key: "event", label: "Events" },
];
export const modeLabel = (key) =>
  MODES.find((m) => m.key === key)?.label ?? key;

/** True for a path this section owns. */
export const isLadder = (path) =>
  path === LADDER || String(path ?? "").startsWith(`${LADDER}/`);

/** The page slug a Ladder path names, "season" for the bare one. */
export function ladderSlug(path) {
  const [, , page] = String(path ?? "").split("/");
  return LADDER_PAGES.some((p) => p.slug === page) ? page : "season";
}

/** A Ladder path resolved to one this section serves: the bare /ladder
 *  is the season home; a known page is itself; a stale or unknown one,
 *  or anything deeper than a page, falls back to the nearest real one
 *  rather than an empty main. Null for a path that is not Ladder's. */
export function ladderLegal(path) {
  if (!isLadder(path)) return null;
  if (path === LADDER) return path;
  const [, , page = "", ...rest] = path.split("/");
  if (page === "" || page === "season") return LADDER;
  if (!LADDER_PAGES.some((p) => p.slug === page)) return LADDER;
  return rest.length ? `${LADDER}/${page}` : path;
}

/** Where a Ladder path sits on its rail and in the docs strip. */
export function ladderHere(path) {
  const key = ladderSlug(path);
  return { key, product: "ladder", doc: `ladder:${key}` };
}

/** Tab title: the page first, because a tab truncates from the right. */
export function ladderTitle(path, site = "Elixir MCP") {
  const page = LADDER_PAGES.find((p) => p.slug === ladderSlug(path));
  return `${page?.label ?? "Season"} - Ladder - ${site}`;
}

/** A Ladder address: the page, then the player (no hash, as every tag
 *  in a path or query travels) and the mode. Omitted params stay off. */
export function ladderHref(slug, { player, mode } = {}) {
  const path = !slug || slug === "season" ? LADDER : `${LADDER}/${slug}`;
  const q = new URLSearchParams();
  if (player) q.set("player", tagPath(player));
  if (mode) q.set("mode", mode);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

/** The players Ladder can show: the reader's own, primary first, then
 *  alts. A friend or a watched player is somebody else's season, and
 *  "your record is yours" (the Ladder brief) keeps them out. */
export function ladderPlayers(claims) {
  const own = (claims ?? []).filter(
    (c) =>
      c?.player_tag &&
      (c.is_primary ||
        c.relationship === "primary" ||
        c.relationship === "alt"),
  );
  return [...own].sort(
    (a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)),
  );
}

/** The player a `?player=` names, when it is one of yours; otherwise the
 *  primary. A tag that is not yours never reads someone else's season. */
export function pickPlayer(players, param) {
  const want = param == null ? "" : tagPath(String(param)).toUpperCase();
  return (
    players.find((p) => tagPath(p.player_tag).toUpperCase() === want) ??
    players[0] ??
    null
  );
}

/** The mode a page opens on: the one asked for, when it is one; else
 *  Path of Legends when the last 30 days hold more of it than Trophy
 *  Road, else Trophy Road (the Ladder brief: the default is the mode
 *  played most). `modes` is players_summary's last_30_days.modes. */
export function pickMode(param, modes) {
  if (MODES.some((m) => m.key === param)) return param;
  const n = (k) => Number(modes?.[k]?.battles ?? 0);
  return n("ranked") > n("ladder") ? "ranked" : "ladder";
}

/** A player as the page names them: nickname, name, or the tag. */
export const playerName = (p) => p?.nickname ?? p?.name ?? p?.player_tag ?? "";

/* ---------------------------------------------------------------- time
   Ladder writes dates as prose ("Monday, October 5 at 5:00 am"), where
   the console's tables write stamps. Same rule: the account's zone,
   always, and a zone the browser does not know reads as UTC rather than
   failing the page. */

function parts(ts, zone, opts) {
  const d = new Date(ts);
  if (ts == null || Number.isNaN(d.getTime())) return null;
  const make = (timeZone) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).formatToParts(d);
  let list;
  try {
    list = make(zone || "UTC");
  } catch {
    list = make("UTC");
  }
  return Object.fromEntries(list.map(({ type, value }) => [type, value]));
}

/** "Monday, October 5". */
export function longDay(ts, zone) {
  const p = parts(ts, zone, { weekday: "long", month: "long", day: "numeric" });
  return p ? `${p.weekday}, ${p.month} ${p.day}` : "";
}

/** "Sep 18". */
export function shortDay(ts, zone) {
  const p = parts(ts, zone, { month: "short", day: "numeric" });
  return p ? `${p.month} ${p.day}` : "";
}

/** "5:00 am". */
export function clockTime(ts, zone) {
  const p = parts(ts, zone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return p ? `${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}` : "";
}

/** A date-only string ("2026-09-07", an ISO week's Monday) as "Sep 7",
 *  read as the calendar date it names rather than an instant. */
export function dateLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ""));
  if (!m) return "";
  return shortDay(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`, "UTC");
}

/** "September" from a season's month, "2026-09". */
export function monthName(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ""));
  if (!m) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${m[1]}-${m[2]}-15T12:00:00Z`));
}

/* ------------------------------------------------------------- numbers */

const NF = new Intl.NumberFormat("en-US");
export const fmt = (n) => (n == null ? "—" : NF.format(n));

/** A rate the tool returned (0..1) as a whole percent. */
export const pct = (r) => (r == null ? "—" : `${Math.round(r * 100)}%`);

/** A signed number with a true minus: "+29", "−6", "0". */
export function signed(n, digits = 0) {
  if (n == null) return "—";
  const s = Math.abs(n).toFixed(digits);
  if (Number(s) === 0) return digits ? Number(0).toFixed(digits) : "0";
  return `${n > 0 ? "+" : "−"}${Number(s).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/* ---------------------------------------------------------- the season */

/** The season home's header facts, from battles_performance's applied
 *  window: "September season", the days in, and when it ends. */
export function seasonHead(applied) {
  const season = applied?.window?.season ?? null;
  return {
    month: season?.month ?? null,
    name: season?.month ? `${monthName(season.month)} season` : "This season",
    age: applied?.window?.season_age_days ?? null,
    startsAt: season?.starts_at ?? null,
    endsAt: season?.ends_at ?? null,
  };
}

/** The fourth tile: the trophy range when the tool returned one (the
 *  trophies landed on after each Trophy Road battle), net trophies in
 *  a trophy mode without one, and crowns elsewhere, where trophies do
 *  not move. Each is a number the tool returned, never a blend. */
export function fourthTile(mode, window, floor) {
  const range = floor?.trophy_range;
  if (range && range.lowest != null && range.highest != null)
    return {
      label: "Trophy range",
      value:
        range.lowest === range.highest
          ? fmt(range.lowest)
          : `${fmt(range.lowest)}–${fmt(range.highest)}`,
    };
  if ((mode === "ladder" || mode === "ranked") && window?.net_trophies != null)
    return { label: "Net trophies", value: signed(window.net_trophies) };
  if (window?.crowns_for != null && window?.crowns_against != null)
    return {
      label: "Crowns",
      value: `${fmt(window.crowns_for)}–${fmt(window.crowns_against)}`,
    };
  return null;
}

/** The floor callout, from trophy_floor: where the player stood and how
 *  many losses there cost nothing. The tool's own note says why net
 *  trophies mislead there; this is that note, in the page's words. */
export function floorNote(floor) {
  if (!floor?.floored || floor.floor == null) return null;
  const arena = floor.arena?.name ? ` (${floor.arena.name})` : "";
  const n = Number(floor.on_floor_losses ?? 0);
  const losses =
    n === 0
      ? ""
      : ` ${n === 1 ? "One loss" : `${spell(n)} losses`} there cost nothing, so net trophies say more about how recently you played than how well: read the range and the win rate.`;
  return `You stood on the ${fmt(floor.floor)} floor${arena} this season.${losses}`;
}

const WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];
/** Small counts as a word at the start of a sentence, the rest as digits. */
const spell = (n) => WORDS[n] ?? fmt(n);

/** The week-by-week bars from battles_performance group_by week,
 *  oldest first as the tool returns them, which is how a chart reads
 *  left to right. `unit` is pixels per battle, shared by wins and
 *  losses so the two halves compare; it shrinks to fit the tallest
 *  week into the chart's two halves. `net` off leaves net trophies out
 *  of the note, for modes where trophies do not move. */
export function weekBars(
  weekly,
  { net = true, up = 70, down = 112, max = 16 } = {},
) {
  const rows = weekly ?? [];
  const most = (k) => Math.max(1, ...rows.map((w) => Number(w[k] ?? 0)));
  const unit = Math.min(max, up / most("wins"), down / most("losses"));
  return rows.map((w) => ({
    key: w.iso_week ?? w.week_of,
    label: dateLabel(w.week_of),
    wins: Number(w.wins ?? 0),
    losses: Number(w.losses ?? 0),
    winH: Math.round(Number(w.wins ?? 0) * unit),
    lossH: Math.round(Number(w.losses ?? 0) * unit),
    rate: w.win_rate ?? null,
    partial: Boolean(w.partial),
    note: [
      w.partial ? "partial" : null,
      net && w.net_trophies != null ? signed(w.net_trophies) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

/** The most-played deck's record lines, one per mode it was played in.
 *  A rate shows only when the deck was played in ONE mode, where the
 *  tool's win_rate is that mode's own; across modes it would pool them,
 *  so each mode shows its wins and losses and no rate. */
export function deckModes(deck) {
  const modes = Object.entries(deck?.modes ?? {}).filter(
    ([, m]) => Number(m?.battles ?? 0) > 0,
  );
  const one = modes.length === 1;
  return modes.map(([key, m]) => ({
    key,
    label: modeLabel(key),
    wins: Number(m.wins ?? 0),
    losses: Number(m.losses ?? 0),
    rate: one ? (deck.win_rate ?? null) : null,
  }));
}
