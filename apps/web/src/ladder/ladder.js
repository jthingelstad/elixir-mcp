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
import { tagPath } from "../lib/tag-url.js";

export const LADDER = "/ladder";

/** The pages, in rail order. `slug` "season" is the bare /ladder. */
export const LADDER_PAGES = [
  { slug: "season", label: "Season", icon: "chart-line" },
  { slug: "days", label: "Days played", icon: "calendar-days" },
  { slug: "decks", label: "Decks", icon: "layers" },
  { slug: "cards", label: "Cards", icon: "gallery-horizontal-end" },
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
export function ladderTitle(path, site = "Elixir") {
  const page = LADDER_PAGES.find((p) => p.slug === ladderSlug(path));
  return `${page?.label ?? "Season"} - Ladder - ${site}`;
}

/** A Ladder address: the page, then the player (no hash, as every tag
 *  in a path or query travels), the mode, the season and, on Cards, the
 *  order of what you faced. Omitted params stay off; no season is the
 *  current one (or the last one with battles, pickSeason), and no order
 *  is the tools' own (most battles first). */
export function ladderHref(slug, { player, mode, season, order } = {}) {
  const path = !slug || slug === "season" ? LADDER : `${LADDER}/${slug}`;
  const q = new URLSearchParams();
  if (player) q.set("player", tagPath(player));
  if (mode) q.set("mode", mode);
  if (season != null && season !== "") q.set("season", String(season));
  if (slug === "cards" && order === "losses") q.set("order", order);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

/* --------------------------------------------------------- the season
   Ladder reads one season at a time (2026-10-08), named in the address
   (`?season=136`) so a link, a reload or a mail lands on the season it
   meant. The tools take the season themselves ('current', 'previous',
   the month the API names it by, or the river race season number), so
   the page only chooses which one to ask for. */

/** The tools' `season` argument for a `?season=`: a river race season
 *  number (136; the router may hand it over as a number), the month the
 *  API names it by ("2026-09"), "previous", and "current" for nothing or
 *  anything else. */
export function seasonArg(param) {
  if (param == null) return "current";
  const s = String(param).trim();
  if (/^\d{1,4}$/.test(s)) return Number(s);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (s === "previous") return "previous";
  return "current";
}

/** A season as Elixir names it everywhere (the mail, Elixir Clan,
 *  Explore's war weeks): "Season 136". A season row with no river race
 *  number yet falls back to its month. */
export function seasonName(season) {
  if (season?.war != null) return `Season ${season.war}`;
  if (season?.month) return `${monthName(season.month)} season`;
  return "This season";
}

/** The key a season travels by in an address: its number, else its month. */
const seasonKey = (s) =>
  s?.war != null ? String(s.war) : String(s?.month ?? "");

/**
 * The seasons a player has on record, newest first, from one
 * battles_performance read that starts at the player's first recorded
 * battle (meta.recorded_since): applied.window.season is the season it
 * starts in and crosses every roll since, the last of which is the
 * season now running. Each comes as the tool named it; nothing here
 * counts or rates them.
 */
export function recordedSeasons(applied) {
  const w = applied?.window;
  const list = [
    w?.season ? { month: w.season.month, war: w.season.war } : null,
    ...(w?.crosses ?? []).map((c) => c?.to_season ?? null),
  ].filter((s) => s && (s.war != null || s.month));
  const seen = new Set();
  const out = [];
  for (const s of list.reverse()) {
    const key = seasonKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, war: s.war ?? null, month: s.month ?? null });
  }
  return out.map((s, i) => ({ ...s, name: seasonName(s), current: i === 0 }));
}

/**
 * Which season a page reads, from the address and two reads LadderPage
 * makes: `seasons` (recordedSeasons, newest first) and `currentBattles`
 * (the current season's battles over every mode; undefined while it is
 * read, null when it could not be).
 *
 * An address that names a season gets that season, even an empty one.
 * With none, the page reads the current season, unless it has no
 * recorded battle yet and an earlier season is on record: then it reads
 * the one before, and `fallback` names the empty current season, so the
 * page says so and offers it one click away. The first days of every
 * season would otherwise open on an empty page. A refused read falls
 * back to the current season, never a guess.
 */
export function pickSeason(param, { seasons, currentBattles } = {}) {
  const list = seasons ?? [];
  const asked = param != null && String(param).trim() !== "";
  const arg = seasonArg(param);
  const find = (a) =>
    a === "current"
      ? list[0]
      : a === "previous"
        ? list[1]
        : list.find((s) =>
            typeof a === "number" ? s.war === a : s.month === String(a),
          );
  const shape = (a, fallback = null) => {
    const s = find(a) ?? null;
    return {
      arg: a,
      key: s?.key ?? String(a),
      name:
        s?.name ??
        (typeof a === "number"
          ? `Season ${a}`
          : /^\d{4}-\d{2}$/.test(String(a))
            ? `${monthName(a)} season`
            : a === "previous"
              ? "Last season"
              : "This season"),
      current: a === "current" || Boolean(s?.current),
      fallback,
      ready: true,
    };
  };
  if (asked) return shape(arg);
  if (currentBattles === undefined)
    return { ...shape("current"), ready: false };
  if (currentBattles !== 0) return shape("current");
  if (seasons === undefined) return { ...shape("current"), ready: false };
  if (list.length > 1) {
    const prev = list[1];
    return shape(prev.war ?? prev.month, list[0]);
  }
  return shape("current");
}

/** The words a page uses for the season it reads: "this season" for
 *  the one running, "in Season 136" for any other. */
export const seasonWords = (season) =>
  !season || season.current ? "this season" : `in ${season.name}`;

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
 *  the mode with the most recorded battles in the last 30 days
 *  (the Ladder brief: the default is the mode
 *  played most). `modes` is players_summary's last_30_days.modes. */
export function pickMode(param, modes) {
  if (MODES.some((m) => m.key === param)) return param;
  const n = (k) => Number(modes?.[k]?.battles ?? 0);
  return MODES.reduce(
    (best, m) => (n(m.key) > n(best) ? m.key : best),
    "ladder",
  );
}

/**
 * The first capture has not landed yet (2026-10-08). A player just added
 * has nothing to read back, and an empty mode or a refusal would read as
 * a fault, so LadderPage shows Pending instead. Taken from the
 * players_summary read the page already makes.
 *
 * The two reads of a first capture land in either order, seconds or
 * minutes apart, and Pending holds until the battle log is in:
 *   * battle log first: the summary refuses `not_recorded` until the
 *     profile lands (it answers from the profile), so pending;
 *   * profile first (the usual order, within seconds of the add): the
 *     summary answers with the profile and no battles, and its meta
 *     already carries recorded_since (the profile snapshot). That is not
 *     a capture yet: pending until the battle log has been read
 *     (source_polls.player_battlelog.observed_at), with battles or with
 *     none (an inactive real player: an empty record is the answer, so
 *     the page never spins forever).
 * A typo'd tag never gets a profile (Clash Royale answers 404, and its
 * battle log for an unknown tag is an empty 200), so it stays pending and
 * Pending says "Tag not found". History older than the summary's 30 days
 * (recorded_since before its window) is a record to show, read or not.
 */
export function capturePending(summary) {
  if (summary?.isError) return summary.error?.code === "not_recorded";
  const data = summary?.data;
  const meta = data?.meta;
  if (!meta) return false;
  if (meta.source_polls?.player_battlelog?.observed_at != null) return false;
  if ((data.last_30_days?.battles ?? 0) > 0) return false;
  const since = Date.parse(meta.recorded_since ?? "");
  const from = Date.parse(
    data.applied?.window?.from ??
      (meta.as_of
        ? new Date(Date.parse(meta.as_of) - 30 * 86_400_000).toISOString()
        : ""),
  );
  return !(Number.isFinite(since) && Number.isFinite(from) && since < from);
}

/**
 * Pending's side of the same rule, from the Console's first-answer
 * status: the capture has landed once the profile is in and the battle
 * log has been read (with battles, or none for an inactive player). A
 * battle log alone is not enough: the summary still refuses until the
 * profile lands, and one refresh spent then would leave the page pending.
 */
export function captureLanded(player) {
  return Boolean(
    player?.profile_available &&
    (player.battlelog_observed_at || player.last_battle_at),
  );
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

/** The zone's short name at an instant, "CDT" or "UTC", so a time Ladder
 *  prints says whose clock it is, as the battle page's does. */
export function zoneShort(ts, zone) {
  const p = parts(ts, zone, { timeZoneName: "short" });
  return p?.timeZoneName ?? "";
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
 *  window: "Season 136", the days in, and when it ends. */
export function seasonHead(applied) {
  const season = applied?.window?.season ?? null;
  return {
    month: season?.month ?? null,
    name: seasonName(season),
    age: applied?.window?.season_age_days ?? null,
    startsAt: season?.starts_at ?? null,
    endsAt: season?.ends_at ?? null,
    // A season still running is read to now: its window has no end.
    running: Boolean(season) && applied?.window?.to == null,
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
export function floorNote(floor, when = "this season") {
  if (!floor?.floored || floor.floor == null) return null;
  const arena = floor.arena?.name ? ` (${floor.arena.name})` : "";
  const n = Number(floor.on_floor_losses ?? 0);
  const losses =
    n === 0
      ? ""
      : ` ${n === 1 ? "One loss" : `${spell(n)} losses`} there cost nothing, so net trophies say more about how recently you played than how well: read the range and the win rate.`;
  return `You stood on the ${fmt(floor.floor)} floor${arena} ${when}.${losses}`;
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

/* ---------------------------------------------------------------- form
   "Am I improving?" read back (2026-10-08): two stretches of one mode's
   record side by side, as @elixir-mcp/record/form shaped them from
   battles_performance. The rows only lay the tool's numbers out, each
   beside the battles it is over; no arrow, colour or word says which
   side is the better one. */

const battlesWord = (n) => `${fmt(n)} ${n === 1 ? "battle" : "battles"}`;

/** The rows of a form table: win rate, three-crown rate and (in a mode
 *  where trophies move) net trophies, each side's value and count. A
 *  number the shaping dropped (null on both sides) has no row. */
export function formRows(a, b) {
  if (!a || !b) return [];
  const rows = [
    {
      key: "win_rate",
      label: "Win rate",
      cells: [a, b].map((s) => ({
        value: pct(s.win_rate),
        count: battlesWord(s.decided_battles),
      })),
    },
  ];
  if (a.three_crown_rate != null && b.three_crown_rate != null)
    rows.push({
      key: "three_crown_rate",
      label: "Three-crown rate",
      cells: [a, b].map((s) => ({
        value: pct(s.three_crown_rate),
        count: battlesWord(s.head_to_head_battles),
      })),
    });
  if (a.net_trophies != null && b.net_trophies != null)
    rows.push({
      key: "net_trophies",
      label: "Net trophies",
      cells: [a, b].map((s) => ({
        value: signed(s.net_trophies),
        count: battlesWord(s.battles),
      })),
    });
  return rows;
}
