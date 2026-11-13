import { checkRateLimit } from "@elixir-mcp/auth";
import { featuredDeck, buildFriendsWeek } from "@elixir-mcp/tools/friends-week";
import { deckIdentities } from "@elixir-mcp/tools/shared";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import {
  buildTimeline,
  readTimelineEvidence,
  shownAt,
  subjectsFor,
} from "@elixir-mcp/tools/activity/entries";
import {
  HOME_WEEK_MS,
  buildOnce,
  feedAfter,
  feedOrder,
  homeAccount,
  readHomeWeek,
} from "@elixir-mcp/tools/activity/home-feed";
import { gameWeekStartMs } from "@elixir-mcp/record/form";
import { lastGameWeek } from "@elixir-mcp/record/game-week";

import { json } from "../http.mjs";
import { toolDeadlineMs } from "../deadline.mjs";
import { annotateFeed, groupsOf } from "../feed.mjs";
import { cheersReceived, withCheers } from "../cheers.mjs";
import { firstAnswer } from "../first-answer.mjs";
import { homeClan, myClans } from "./clans.mjs";

/** Home's reads: the app's own internal API, not a JSON API version. The
 *  page paints from `/api/me/home` (who you are, new account or not) and each
 *  slow panel then asks for itself (`/needs`, `/clan`, `/week`, `/latest`), so
 *  one slow or failed panel never holds up or takes down the others (2026-11-06:
 *  as one request they ran in series to 18 s, and a 504 lost the whole page).
 *
 *  Inside a request reads still run one after another. A request holds one
 *  client (docs/ENGINEERING.md: one client, one query at a time), a pool is
 *  four of them, and the instance is the 1 GB micro: going parallel inside a
 *  panel would take leases the other panels are waiting for.
 *
 *  A visit still spends one charge on the hourly bucket /mcp and Explore share:
 *  the head's. The panels count on a bucket of their own (`panelRate`). */

/** Below about this many battles a "most played" deck says little (the
 *  board's rule). */
const DECK_FROM = 5;
const LEADERS = new Set(["leader", "coLeader"]);
/** The modes a week's chips can name, the ones Ladder names plus Casual. */
const WEEK_MODES = ["ladder", "ranked", "war", "casual", "event"];

/** One panel's read: its answer, or that it could not be read. Either way one
 *  line names the panel and how long it took, so the slow one can be read off
 *  the log. Never a tag or a name in it. */
export async function panel(name, read, meta = null) {
  const started = Date.now();
  try {
    const answer = { ok: true, ...(await read()) };
    console.info(
      JSON.stringify({
        at: "home_panel",
        panel: name,
        ms: Date.now() - started,
        ...meta,
      }),
    );
    return answer;
  } catch (err) {
    console.error(
      JSON.stringify({
        at: "home_panel_failed",
        panel: name,
        code: err?.code ?? null,
        ms: Date.now() - started,
      }),
    );
    return { ok: false };
  }
}

function toolReader(db, account, registry, event) {
  const invoke = makeInvoker({
    db,
    account,
    registry,
    surface: "web",
    deadlineMs: toolDeadlineMs(event),
  });
  return async (tool, args) => {
    const r = await invoke(tool, args);
    if (r.isError) {
      const err = new Error(`${tool} failed`);
      err.code = r.body?.error?.code ?? "tool_error";
      throw err;
    }
    return r.body;
  };
}

/** The mode a week opens on: the most played of the chips', Trophy Road when
 *  there are none. */
export function openingMode(modes) {
  const played = WEEK_MODES.filter((m) => (modes?.[m]?.battles ?? 0) > 0).sort(
    (a, b) => modes[b].battles - modes[a].battles,
  );
  return played[0] ?? "ladder";
}

/** The trophies on the player's latest snapshot, which is all this panel took
 *  from players_summary: that tool also builds a 30-day record and two deck
 *  rankings (about twenty statements) and the panel drew none of them. The same
 *  row its `trophies` comes from. */
async function latestTrophies(db, tag) {
  const { rows } = await db.query(
    `select trophies from player_snapshot_daily where player_tag = $1
      order by snapshot_date desc, snapshot_kind desc limit 1`,
    [tag],
  );
  return rows[0]?.trophies ?? null;
}

/** The primary player, for a read that needs only the tag. */
async function primaryTag(db, accountId) {
  const { rows } = await db.query(
    "select player_tag from claim where account_id = $1 and is_primary limit 1",
    [accountId],
  );
  return rows[0]?.player_tag ?? null;
}

/** Your week since Monday's reset, in one mode: modes are different games
 *  and nothing here pools them. */
export async function readWeek(read, db, tag, wanted, now = Date.now()) {
  const from = new Date(gameWeekStartMs(now)).toISOString();
  const to = new Date(now).toISOString();
  const window = { from, to };
  const all = await read("battles_performance", { player_tag: tag, ...window });
  const modes = Object.fromEntries(
    Object.entries(all?.window?.modes ?? {}).map(([m, v]) => [
      m,
      { battles: v.battles, wins: v.wins, losses: v.losses },
    ]),
  );
  const mode = WEEK_MODES.includes(wanted) ? wanted : openingMode(modes);
  const battles = modes[mode]?.battles ?? 0;
  // A week played in this mode alone: the whole sample is this mode's, so its
  // net is already in hand.
  const onlyThisMode = battles > 0 && battles === all?.window?.battles;
  const out = {
    from,
    mode,
    modes,
    record: modes[mode] ?? { battles: 0, wins: 0, losses: 0 },
    net_trophies: null,
    trophies: null,
    deck: null,
    last_battle_at: null,
  };
  if (mode === "ladder" || mode === "ranked") {
    const one = onlyThisMode
      ? all
      : await read("battles_performance", {
          player_tag: tag,
          ...window,
          mode,
        });
    out.net_trophies = one?.window?.net_trophies ?? null;
  }
  if (mode === "ladder") out.trophies = await latestTrophies(db, tag);
  if (battles >= DECK_FROM) {
    const list = await read("battles_decks", {
      player_tag: tag,
      ...window,
      mode,
      limit: 1,
    });
    const top = list?.decks?.[0];
    if (top) {
      // The cards from the identity battles_decks itself reads. Asking it
      // for the one deck reran the window's whole aggregate for them.
      const identity = (await deckIdentities(db, [top.deck_hash])).get(
        top.deck_hash,
      );
      out.deck = featuredDeck(top, {
        ...identity,
        archetype_label: identity?.archetype?.label ?? null,
      });
    }
  }
  if (battles === 0) {
    const last = await read("battles_query", {
      player_tag: tag,
      mode,
      limit: 1,
      verbosity: "compact",
    });
    out.last_battle_at = last?.battles?.[0]?.battle_time ?? null;
  }
  return out;
}

/** What Clan's own `/home` answers, shaped for the card. Own clock only: no
 *  other member's days reach anyone below co-leader except through an Action
 *  they may already take. */
export function shapeClan(view, { lastRace = null, raceNow = null } = {}) {
  const m = view?.member ?? null;
  const you = m?.you ?? null;
  const open = you?.this_war_week ?? null;
  const inactivity = m?.clan?.inactivity ?? null;
  const leads = LEADERS.has(view.role);
  return {
    clan_tag: view.clan_tag,
    name: view.name ?? m?.clan_name ?? null,
    role: view.role,
    verified: view.verified,
    unlock: view.unlock ?? null,
    policy_set: view.policy_set === true,
    members: m?.members ?? null,
    min_members: view.min_members,
    as_of: m?.as_of ?? null,
    last_race: lastRace,
    race_now: raceNow,
    war_decks: open
      ? { decks: open.decks, asked: null, open: true }
      : lastFinished(you?.war_weeks),
    donations: you?.this_week?.donations ?? null,
    // Leaders and co-leaders are not banded; nor is anyone where the clan
    // doesn't rank Elder.
    standing: leads || !m?.clan?.ranks_elder ? null : (m.clan.status ?? null),
    clock:
      inactivity?.state === "at_risk"
        ? {
            days_idle: Math.floor(inactivity.days_idle ?? 0),
            at_risk_days: inactivity.at_risk_days,
          }
        : null,
    needs: view.needs ?? [],
    needs_total: view.needs_total ?? 0,
  };
}

/** After a race's finish the card says "16 of 16". Only for a race that
 *  started in this game week. */
function lastFinished(weeks, now = Date.now()) {
  const monday = gameWeekStartMs(now);
  const race = (weeks ?? []).find(
    (w) => w.started_at && Date.parse(w.started_at) >= monday && !w.open,
  );
  return race
    ? { decks: race.decks, asked: race.decks_asked, open: false }
    : null;
}

/** The card's last race. A clan with no race on record yet has no such row;
 *  it is no reason to lose the rest of the card. */
async function readLastRace(read, clanTag) {
  const history = await read("war_history", {
    clan_tag: clanTag,
    seasons: 2,
  }).catch((err) => {
    if (err.code === "not_recorded") return null;
    throw err;
  });
  const week = (history?.weeks ?? []).find(
    (w) => !w.in_progress && w.our_rank != null,
  );
  return week
    ? {
        season_id: week.season_id,
        section_index: week.section_index,
        is_colosseum: week.is_colosseum === true,
        rank: week.our_rank,
        fame: week.our_fame ?? null,
      }
    : null;
}

/** The race this week, as facts: which week and day, and on a war day the
 *  boat's place by fame among the clans in it and its fame. A training day
 *  says so and nothing more; no race recorded, or no day known, is none.
 *  Never the day's decks: war surfaces count decks by the week (DECISIONS
 *  "Decks, not days"). */
export function shapeRaceNow(current, clanTag, now = Date.now()) {
  if (!current || !["war", "training"].includes(current.day_kind)) return null;
  const base = {
    season_id: current.season_id,
    section_index: current.section_index,
    is_colosseum: current.is_colosseum === true,
    day_kind: current.day_kind,
    war_day: current.war_day ?? null,
  };
  if (current.day_kind === "training") return base;
  const boats = current.standings ?? [];
  const own = boats.find((r) => r.participant_clan_tag === clanTag) ?? null;
  const fame = own?.fame ?? null;
  // A place only when it is one: fame banked, and no other clan level with
  // it. Before any fame (a first war day) or on a tie, the place is unknown
  // rather than an order the sort happened to give (Codex on #792).
  const others = boats.filter((r) => r !== own);
  const place =
    fame != null && fame > 0 && !others.some((r) => (r.fame ?? 0) === fame)
      ? 1 + others.filter((r) => (r.fame ?? 0) > fame).length
      : null;
  return {
    ...base,
    finished:
      current.race_finished_at != null &&
      Date.parse(current.race_finished_at) <= now,
    place,
    fame,
  };
}

/** The race now, or none: a clan with no race recorded keeps the rest of
 *  the card. */
async function readRaceNow(read, clanTag) {
  const current = await read("war_current", {
    clan_tag: clanTag,
    verbosity: "compact",
  }).catch((err) => {
    if (err.code === "not_recorded") return null;
    throw err;
  });
  return shapeRaceNow(current, clanTag);
}

/** Clan's own read, called in-process as its door calls it: the same gate,
 *  role checks and closed reader, with the person this request authenticated. */
async function readClanView(
  clan,
  { db, account, event, clanTag, requestId, read = "home", query = {} },
) {
  const res = await clan({
    db,
    account,
    requestId,
    event: {
      ...event,
      method: "GET",
      path: `/api/clan/clans/${clanTag.replace(/^#/, "")}/${read}`,
      body: undefined,
      queryStringParameters: query,
    },
    signout: async () => null,
  });
  if (res.statusCode === 200) return JSON.parse(res.body);
  // Tracked, but the person holds no place Clan can show (no role seen yet).
  if (res.statusCode === 403 || res.statusCode === 404) return null;
  throw Object.assign(new Error("clan read failed"), { code: "clan_read" });
}

/** Whether this account tracks the clan, all a tracked clan's reads need of
 *  `myClans`, which also counts its members and pools its slots. */
async function followsClan(db, accountId, clanTag) {
  const { rows } = await db.query(
    "select 1 from account_clan where account_id = $1 and clan_tag = $2",
    [accountId, clanTag],
  );
  return rows.length > 0;
}

/** How long a stored clan card is served as it is (home_clan_card, 0248),
 *  and how long it is served at all. Past fresh, the answer says
 *  `refresh` and the page asks for the card built again while it shows
 *  this one, up to a week old (an expiry or a deploy never makes the
 *  reader wait); past that, or on another basis, the read builds it
 *  itself. */
const CLAN_CARD_FRESH_MS = 15 * 60_000;
const CLAN_CARD_KEEP_MS = 7 * 24 * 60 * 60_000;
/** The card's fields that are never stored: Clan's gate answers them on
 *  every read (Actions, the unlock notice, the reader's role). */
const CLAN_CARD_LIVE = ["needs", "needs_total", "unlock", "role", "verified"];

async function storedClanCard(db, accountId) {
  const { rows } = await db.query(
    `select clan_tag, basis, card, built_at from home_clan_card
      where account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/** Keep the card's record half. A build that started before the stored
 *  one never replaces it. */
async function storeClanCard(db, accountId, { clanTag, basis, card, started }) {
  const kept = Object.fromEntries(
    Object.entries(card).filter(([k]) => !CLAN_CARD_LIVE.includes(k)),
  );
  await db.query(
    `insert into home_clan_card (account_id, clan_tag, basis, built_at, build_ms, card)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (account_id) do update
       set clan_tag = excluded.clan_tag, basis = excluded.basis,
           built_at = excluded.built_at, build_ms = excluded.build_ms,
           card = excluded.card
     where home_clan_card.built_at <= excluded.built_at`,
    [
      accountId,
      clanTag,
      basis,
      new Date(started),
      Date.now() - started,
      JSON.stringify(kept),
    ],
  );
}

/** The card as it is built from the record: the war reads and Clan's own
 *  "You here". `gate` is Clan's live answer for this reader (null when
 *  it holds no place Clan can show). */
async function buildClanCard(
  { db, account, event, read, clan, requestId },
  home,
  gate,
) {
  const lastRace = await readLastRace(read, home.clan_tag);
  const raceNow = await readRaceNow(read, home.clan_tag);
  const view =
    clan && gate
      ? await readClanView(clan, {
          db,
          account,
          event,
          clanTag: home.clan_tag,
          requestId,
        })
      : null;
  if (!view)
    return {
      state: "tracked",
      clan_tag: home.clan_tag,
      name: home.name ?? null,
      last_race: lastRace,
      race_now: raceNow,
      needs: [],
      needs_total: 0,
    };
  return {
    state: "member",
    ...shapeClan({ name: home.name, ...view }, { lastRace, raceNow }),
  };
}

/** Home's clan card. Its record half (the race, your week, your standing)
 *  is kept per account and served while fresh; Clan's gate is asked on
 *  every read, and what it answers (Actions waiting on you, the unlock
 *  notice, your role) is laid over the kept half. The gate's basis (your
 *  player, role and verification, the policy's version, the clan's
 *  holds) is kept beside it: a read whose basis differs, a departure the
 *  gate refuses, another clan, or a card past a week builds now.
 *  `rebuild` builds it whatever its age (the page's ask past fresh). One
 *  build per account at a time: a second reader waits for it and is
 *  served the card it stored. */
async function readClanPanel(ctx, { rebuild = false, meta = null } = {}) {
  const { db, account, event, clan, requestId } = ctx;
  const home = await homeClan(db, account.accountId);
  if (!home) return { state: "none" };
  if (!(await followsClan(db, account.accountId, home.clan_tag)))
    return {
      state: "untracked",
      clan_tag: home.clan_tag,
      name: home.name ?? null,
      slots: (await myClans(db, account)).slots.activity,
    };
  const gate = clan
    ? await readClanView(clan, {
        db,
        account,
        event,
        clanTag: home.clan_tag,
        requestId,
        read: "needs",
        query: { basis: "1" },
      })
    : null;
  const basis = gate?.basis ? `member:${gate.basis}` : "tracked";
  const live = gate
    ? {
        role: gate.role,
        verified: gate.verified,
        unlock: gate.unlock ?? null,
        needs: gate.needs ?? [],
        needs_total: gate.needs_total ?? 0,
      }
    : { needs: [], needs_total: 0 };
  const serve = (row, within) => {
    const age = row ? Date.now() - Date.parse(row.built_at) : null;
    if (
      !row ||
      row.clan_tag !== home.clan_tag ||
      row.basis !== basis ||
      !(age >= 0 && age < within) ||
      row.card?.state !== (gate ? "member" : "tracked")
    )
      return null;
    if (meta) Object.assign(meta, { stored: true, age_ms: age });
    return {
      ...row.card,
      name: home.name ?? row.card.name ?? null,
      ...(gate ? live : { needs: [], needs_total: 0 }),
      built_at: new Date(row.built_at).toISOString(),
      refresh: age >= CLAN_CARD_FRESH_MS,
    };
  };
  // A rebuild that finds a fresh card (another page's rebuild stored it)
  // serves that one.
  const kept = serve(
    await storedClanCard(db, account.accountId),
    rebuild ? CLAN_CARD_FRESH_MS : CLAN_CARD_KEEP_MS,
  );
  if (kept) return kept;
  return buildOnce(db, "home_clan_card", account.accountId, {
    build: () => buildAndStoreClanCard(ctx, { home, gate, live, basis, meta }),
    reuse: async () =>
      serve(await storedClanCard(db, account.accountId), CLAN_CARD_FRESH_MS),
  });
}

async function buildAndStoreClanCard(ctx, { home, gate, live, basis, meta }) {
  const { db, account } = ctx;
  const started = Date.now();
  const card = await buildClanCard(ctx, home, gate);
  // Clan's gate is the authority on the live half, even when the card's
  // own read raced it.
  const out = gate && card.state === "member" ? { ...card, ...live } : card;
  await storeClanCard(db, account.accountId, {
    clanTag: home.clan_tag,
    basis,
    card: out,
    started,
  }).catch((err) =>
    console.error(
      JSON.stringify({
        at: "home_clan_card_store_failed",
        code: err?.code ?? null,
      }),
    ),
  );
  if (meta) Object.assign(meta, { stored: false });
  return {
    ...out,
    built_at: new Date(started).toISOString(),
    refresh: false,
  };
}

/** Needs you and the unlock notice: Clan's store reads through the same door,
 *  gate and role checks as the card, and none of the card's record reads.
 *  The bell draws it. Its Actions are read live from Clan's store on every
 *  request, never from a stored copy: a waiting Action closes the moment a
 *  leader decides it.
 *
 *  Whether the account tracks the clan does not decide it (2026-11-12,
 *  "a leader with a waiting Action sees it in the bell"): Clan's own gate
 *  admits a member of their clan whether or not Elixir records it, and an
 *  Action waiting on a leader is theirs to see either way. */
async function readNeedsPanel({ db, account, event, clan, requestId }) {
  const home = await homeClan(db, account.accountId);
  if (!home) return { state: "none" };
  const view = clan
    ? await readClanView(clan, {
        db,
        account,
        event,
        clanTag: home.clan_tag,
        requestId,
        read: "needs",
      })
    : null;
  if (!view)
    return {
      state: (await followsClan(db, account.accountId, home.clan_tag))
        ? "tracked"
        : "untracked",
    };
  return {
    state: "member",
    clan_tag: view.clan_tag,
    unlock: view.unlock ?? null,
    needs: view.needs ?? [],
    needs_total: view.needs_total ?? 0,
  };
}

/** How many items a page of Home's feed carries (G1, 2026-11-12). */
const FEED_PAGE = 30;
const FEED_DAYS_MS = HOME_WEEK_MS;
/** A week built again for a page whose stored week was since replaced
 *  (More, an item's evidence) is kept this long for the next such read. */
const FEED_KEEP_MS = 90_000;
const FEED_KEPT_MAX = 32;
const builtFeeds = new Map();

/** Home's week as the timeline builds it, without the account's own
 *  administration (the bell tells that), for a window the store no longer
 *  holds. A build of the same window made in the last 90 s by this
 *  instance is reused. */
async function buildFeed(db, account, { fromMs, toMs }) {
  const key = `${account.accountId}|${fromMs}|${toMs}`;
  const kept = builtFeeds.get(key);
  if (kept && Date.now() - kept.at < FEED_KEEP_MS) return kept;
  const { timezone } = await homeAccount(db, account.accountId);
  const subjects = await subjectsFor(db, account.accountId);
  const built = await buildTimeline(db, subjects, {
    fromMs,
    toMs,
    timezone: account.timezone ?? timezone,
    accountId: account.accountId,
    interactive: true,
    accountLines: false,
  });
  const feed = { at: Date.now(), built, subjects };
  for (const [k, v] of builtFeeds)
    if (Date.now() - v.at >= FEED_KEEP_MS) builtFeeds.delete(k);
  if (builtFeeds.size >= FEED_KEPT_MAX)
    builtFeeds.delete(builtFeeds.keys().next().value);
  builtFeeds.set(key, feed);
  return feed;
}

/** A page's place: the week it reads, how far in, and the item it ended
 *  on (its shown instant and id). The next page starts after that item, so
 *  a highlight or fact posted or removed between pages, which the read
 *  serves live, never repeats or skips one (Codex on #818). A cursor from
 *  before carries no item and reads by offset. Opaque to the page. */
const feedCursor = (fromMs, toMs, offset, last) =>
  Buffer.from(
    JSON.stringify({
      f: fromMs,
      t: toMs,
      o: offset,
      a: Date.parse(shownAt(last)),
      i: last.id,
    }),
  ).toString("base64url");
function readCursor(raw) {
  try {
    const c = JSON.parse(Buffer.from(String(raw), "base64url").toString());
    const keyed = c?.a !== undefined || c?.i !== undefined;
    const ok =
      Number.isSafeInteger(c?.f) &&
      Number.isSafeInteger(c?.t) &&
      Number.isSafeInteger(c?.o) &&
      c.o > 0 &&
      c.o <= 10_000 &&
      c.f < c.t &&
      c.t - c.f <= FEED_DAYS_MS &&
      c.t <= Date.now() + 1000 &&
      (!keyed ||
        (Number.isSafeInteger(c.a) &&
          typeof c.i === "string" &&
          c.i.length > 0 &&
          c.i.length <= 128));
    return ok
      ? {
          fromMs: c.f,
          toMs: c.t,
          offset: c.o,
          last: keyed ? { at: c.a, id: c.i } : null,
        }
      : null;
  } catch {
    return null;
  }
}

/** Home's feed (2026-11-12): the last seven days of everyone you follow,
 *  your clan and you, thirty items a page, newest first (G1). The first page
 *  reads the stored week (home_feed, 0245; #649), or builds it when there is
 *  none to serve; `cursor` reads on in the same week. Each page carries its
 *  own items' chips, sparklines, battle links and cheers, and the first says
 *  how many items each chip holds across the whole week. */
async function readFeed(db, account, cursor, wake) {
  const started = Date.now();
  const { timezone, seenTo: seen_to } = await homeAccount(
    db,
    account.accountId,
  );
  const perf = {};
  const week = await feedWeek(db, account, {
    timezone: account.timezone ?? timezone,
    window: cursor,
    wake,
    perf,
  });
  const all = [...week.items].sort(feedOrder);
  let start = cursor?.offset ?? 0;
  if (cursor?.last) {
    const after = all.findIndex((it) => feedAfter(it, cursor.last));
    start = after === -1 ? all.length : after;
  }
  const page = all.slice(start, start + FEED_PAGE);
  const next = start + FEED_PAGE < all.length ? start + FEED_PAGE : null;
  const out = {
    window: {
      from: new Date(week.fromMs).toISOString(),
      to: new Date(week.toMs).toISOString(),
    },
    seen_to,
    // The chips, sparklines and battle links, and each item's cheers:
    // counts and the reader's own, never who (slice 7, #765).
    timeline: await withCheers(
      db,
      await annotateFeed(db, page, week.subjects),
      account.accountId,
    ),
    total: all.length,
    next:
      next === null
        ? null
        : feedCursor(week.fromMs, week.toMs, next, page[page.length - 1]),
    timeline_more: week.more,
  };
  if (!cursor) {
    const counts = { everyone: all.length, you: 0, friends: 0, clan: 0 };
    const seenMs = seen_to ? Date.parse(seen_to) : null;
    let fresh = 0;
    for (const it of all) {
      for (const g of groupsOf(it, week.subjects)) counts[g] += 1;
      if (seenMs !== null && Date.parse(it.observed_at ?? it.at) > seenMs)
        fresh += 1;
    }
    out.counts = { ...counts, new: fresh, new_since: seen_to };
  }
  console.info(
    JSON.stringify({
      at: "home_panel",
      panel: cursor ? "feed_more" : "feed",
      ms: Date.now() - started,
      stored: week.stored,
      age_ms: week.ageMs ?? null,
      items: all.length,
      parts: perf,
    }),
  );
  return out;
}

/** The week a feed read serves: the stored one, or, for a page of a week
 *  the store has since replaced (More, evidence), that week built again. */
async function feedWeek(db, account, { timezone, window, wake, perf }) {
  const week = await readHomeWeek(db, account.accountId, {
    timezone,
    window: window ? { fromMs: window.fromMs, toMs: window.toMs } : null,
    wake,
    perf,
  });
  if (week) return week;
  const { built, subjects } = await buildFeed(db, account, {
    fromMs: window.fromMs,
    toMs: window.toMs,
  });
  return {
    subjects,
    fromMs: window.fromMs,
    toMs: window.toMs,
    items: built.timeline ?? [],
    more: built.timeline_more ?? 0,
    stored: false,
    ageMs: null,
  };
}

/** One item's evidence (View games, View crossing), from the same week the
 *  feed showed it in: Home's week leaves the account's lines out, so the
 *  timeline's own evidence read (with them) can lack an item a busy week
 *  pushed past its cap (Codex on #795). */
async function readFeedEvidence(db, account, q) {
  const toMs = Date.parse(q.to ?? "");
  const fromMs = Date.parse(q.from ?? "");
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    fromMs >= toMs ||
    toMs - fromMs > FEED_DAYS_MS ||
    toMs > Date.now() + 1000
  )
    return json(400, { error: "invalid_window" });
  const { timezone } = await homeAccount(db, account.accountId);
  const week = await feedWeek(db, account, {
    timezone: account.timezone ?? timezone,
    window: { fromMs, toMs },
    wake: null,
    perf: null,
  });
  const evidence = await readTimelineEvidence(
    db,
    week.items.find((it) => it.id === q.evidence_item_id),
    {
      offset: q.evidence_offset === undefined ? 0 : Number(q.evidence_offset),
      limit: q.evidence_limit === undefined ? 25 : Number(q.evidence_limit),
      expectedVersion: q.expected_evidence_version,
    },
  );
  return json(
    evidence.error ? (evidence.error === "evidence_changed" ? 409 : 404) : 200,
    evidence,
  );
}

async function rate(db, account) {
  // The hourly bucket /mcp and Explore use, charged once for the whole page.
  return checkRateLimit(db, {
    bucket: `mcp#${account.accountId}`,
    max: HOURLY_RATE_LIMIT,
  });
}

/** Four panels a visit, so the head's limit in visits stays what it was. */
const PANEL_RATE_LIMIT = 4 * HOURLY_RATE_LIMIT;

/** A panel's charge: its own bucket, so one visit still spends one charge on
 *  the bucket /mcp and Explore share, while these reads, which cost the most,
 *  stay limited. Your own reads on the website spend no budget either way. */
async function panelRate(db, account) {
  return checkRateLimit(db, {
    bucket: `home#${account.accountId}`,
    max: PANEL_RATE_LIMIT,
  });
}

/** A moment's sentence in this reader's own word for the person: the nickname
 *  their card is titled with, where the sentence opens on the in-game name.
 *  Only ever this response, for the account that set it: the sentence the
 *  timeline, the mail and every other reader get is untouched. */
export function inOwnWords(text, name, nickname) {
  if (!nickname || !name || typeof text !== "string") return text;
  if (!text.startsWith(name)) return text;
  const next = text.charAt(name.length);
  if (next && !/[\s'’,:.;!?]/.test(next)) return text;
  return `${nickname}${text.slice(name.length)}`;
}

const person = (p) => ({
  tag: p.tag,
  name: p.name,
  nickname: p.nickname ?? null,
  clan_tag: p.clan?.tag ?? null,
  battles: p.battles ?? 0,
  wins: p.wins ?? 0,
  losses: p.losses ?? 0,
  // The record, whether or not the builder got as far as this person's deck.
  by_family: p.mode_records ?? [],
  moments: (p.moments ?? []).map((m) => ({
    ...m,
    text: inOwnWords(m.text, p.name, p.nickname),
  })),
  deck: p.deck ?? null,
  line: p.line ?? null,
});

export function homeRoutes({
  resolveAccount,
  exploreRegistry,
  clan,
  wake = null,
}) {
  return {
    // What the first paint needs, and all it waits for.
    "GET /api/me/home": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (!(await rate(db, account)))
        return json(429, { error: "rate_limited" });
      const first = await panel("first_answer", () =>
        firstAnswer(db, account.accountId),
      );
      return json(200, { first });
    },

    // Needs you and the unlock notice, which the top of Home settles on.
    "GET /api/me/home/needs": async (db, event, _body, context) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (!(await panelRate(db, account)))
        return json(429, { error: "rate_limited" });
      const needs = await panel("needs", () =>
        readNeedsPanel({
          db,
          account,
          event,
          clan,
          requestId: context?.requestId ?? null,
        }),
      );
      return json(200, { needs });
    },

    // The clan card and its name in the head. It still carries Needs you, for
    // when that panel's own read fails.
    "GET /api/me/home/clan": async (db, event, _body, context) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (!(await panelRate(db, account)))
        return json(429, { error: "rate_limited" });
      const read = toolReader(db, account, exploreRegistry(), event);
      // `rebuild=1`: the page's ask when the card it was served is past
      // fresh; it builds now and keeps the build.
      const rebuild = event.queryStringParameters?.rebuild === "1";
      const meta = {};
      const clanPanel = await panel(
        rebuild ? "clan_rebuild" : "clan",
        () =>
          readClanPanel(
            {
              db,
              account,
              event,
              read,
              clan,
              requestId: context?.requestId ?? null,
            },
            { rebuild, meta },
          ),
        meta,
      );
      return json(200, { clan: clanPanel });
    },

    // Your week: the opening mode, or the one a chip asked for.
    "GET /api/me/home/week": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (!(await panelRate(db, account)))
        return json(429, { error: "rate_limited" });
      const tag = await primaryTag(db, account.accountId);
      if (!tag) return json(404, { error: "no_player" });
      const read = toolReader(db, account, exploreRegistry(), event);
      const wanted = event.queryStringParameters?.mode ?? null;
      const week = await panel("week", async () => {
        const out = await readWeek(read, db, tag, wanted);
        // Cheers received this week (G4) are the same in every mode: the
        // opening read counts them and a chip's read leaves them out. A
        // failed count is unknown, never zero, and never fails the week.
        if (!wanted)
          out.cheers = await cheersReceived(
            db,
            account.accountId,
            tag,
            Date.parse(out.from),
            Date.now(),
          ).catch((err) => {
            console.error(
              JSON.stringify({
                at: "home_week_cheers_failed",
                code: err?.code ?? null,
              }),
            );
            return null;
          });
        return out;
      });
      return json(200, { week });
    },

    // The feed, thirty items a page. Its place ("New since your last
    // visit") is the timeline's, moved by POST /api/me/timeline/seen as
    // before. `evidence_item_id` reads one item's evidence from the same
    // week.
    "GET /api/me/home/feed": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const q = event.queryStringParameters ?? {};
      if (q.evidence_item_id) return readFeedEvidence(db, account, q);
      const cursor = q.cursor ? readCursor(q.cursor) : null;
      if (q.cursor && !cursor) return json(400, { error: "invalid_cursor" });
      return json(200, await readFeed(db, account, cursor, wake));
    },

    /** Home › Friends: the mail's builder, the mail's week. */
    "GET /api/me/home/friends": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (!(await rate(db, account)))
        return json(429, { error: "rate_limited" });
      const { rows: own } = await db.query(
        `select 1 from claim where account_id = $1
            and (is_primary or relationship in ('primary', 'alt')) limit 1`,
        [account.accountId],
      );
      if (own.length === 0) return json(200, { no_player: true });
      const week = lastGameWeek(new Date());
      const registry = exploreRegistry();
      // Leave the page room to answer: past this the rest keep their counts
      // and go without a deck.
      const stopAt = (event.softDeadlineAt ?? Date.now() + 20_000) - 5_000;
      const started = Date.now();
      const facts = await buildFriendsWeek({
        db,
        account: { ...account, timezone: account.timezone ?? "UTC" },
        week,
        season: week.season,
        callTool: (ctx, name, args) => registry.invoke(name, ctx, args),
        within: () => Date.now() < stopAt,
      });
      console.info(
        JSON.stringify({
          at: "home_panel",
          panel: "friends",
          ms: Date.now() - started,
        }),
      );
      // Whose card opens their Clan member page rather than the record.
      const home = await homeClan(db, account.accountId);
      return json(200, {
        own_clan_tag: home?.clan_tag ?? null,
        week: { label: week.label, key: week.key },
        friends: (facts?.friends ?? []).map(person),
        watching: (facts?.watching ?? []).map(person),
        // Nothing to say this week; who that is, and for how long. A gap is
        // unknown, so the page says "recorded", never that they did not play.
        quiet: (facts?.quiet ?? []).filter((q) =>
          ["friend", "watching"].includes(q.relationship),
        ),
      });
    },
  };
}
