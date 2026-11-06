import { checkRateLimit } from "@elixir-mcp/auth";
import { featuredDeck, buildFriendsWeek } from "@elixir-mcp/tools/friends-week";
import { deckIdentities } from "@elixir-mcp/tools/shared";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import {
  newestItems,
  shownAt,
  subjectsFor,
} from "@elixir-mcp/tools/activity/entries";
import { gameWeekStartMs } from "@elixir-mcp/record/form";
import { lastGameWeek } from "@elixir-mcp/record/game-week";

import { json } from "../http.mjs";
import { toolDeadlineMs } from "../deadline.mjs";
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

const LATEST = 5;
/** Below about this many battles a "most played" deck says little (the
 *  board's rule). */
const DECK_FROM = 5;
const LEADERS = new Set(["leader", "coLeader"]);
/** The modes a week's chips can name, the ones Ladder names plus Casual. */
const WEEK_MODES = ["ladder", "ranked", "war", "casual", "event"];

/** One panel's read: its answer, or that it could not be read. Either way one
 *  line names the panel and how long it took, so the slow one can be read off
 *  the log. Never a tag or a name in it. */
export async function panel(name, read) {
  const started = Date.now();
  try {
    const answer = { ok: true, ...(await read()) };
    console.info(
      JSON.stringify({
        at: "home_panel",
        panel: name,
        ms: Date.now() - started,
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
export function shapeClan(view, { lastRace = null } = {}) {
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

/** Clan's own read, called in-process as its door calls it: the same gate,
 *  role checks and closed reader, with the person this request authenticated. */
async function readClanView(
  clan,
  { db, account, event, clanTag, requestId, read = "home" },
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
      queryStringParameters: {},
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
async function tracksClan(db, accountId, clanTag) {
  const { rows } = await db.query(
    "select 1 from account_clan where account_id = $1 and clan_tag = $2",
    [accountId, clanTag],
  );
  return rows.length > 0;
}

async function readClanPanel({ db, account, event, read, clan, requestId }) {
  const home = await homeClan(db, account.accountId);
  if (!home) return { state: "none" };
  if (!(await tracksClan(db, account.accountId, home.clan_tag)))
    return {
      state: "untracked",
      clan_tag: home.clan_tag,
      name: home.name ?? null,
      slots: (await myClans(db, account)).slots.activity,
    };
  const lastRace = await readLastRace(read, home.clan_tag);
  const view = clan
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
      needs: [],
      needs_total: 0,
    };
  return {
    state: "member",
    ...shapeClan({ name: home.name, ...view }, { lastRace }),
  };
}

/** Needs you and the unlock notice: Clan's store reads through the same door,
 *  gate and role checks as the card, and none of the card's record reads. */
async function readNeedsPanel({ db, account, event, clan, requestId }) {
  const home = await homeClan(db, account.accountId);
  if (!home) return { state: "none" };
  const tracked = await tracksClan(db, account.accountId, home.clan_tag);
  const view =
    tracked && clan
      ? await readClanView(clan, {
          db,
          account,
          event,
          clanTag: home.clan_tag,
          requestId,
          read: "needs",
        })
      : null;
  if (!view) return { state: tracked ? "tracked" : "untracked" };
  return {
    state: "member",
    clan_tag: view.clan_tag,
    unlock: view.unlock ?? null,
    needs: view.needs ?? [],
    needs_total: view.needs_total ?? 0,
  };
}

async function readLatest(db, account) {
  const now = Date.now();
  const subjects = await subjectsFor(db, account.accountId);
  const perf = {};
  const newest = await newestItems(
    db,
    subjects,
    {
      fromMs: now - 7 * 86_400_000,
      toMs: now,
      timezone: account.timezone ?? "UTC",
      accountId: account.accountId,
      interactive: true,
      perf,
    },
    LATEST,
  );
  // Where this panel's time goes: a builder's name beside its ms, and how many
  // quiet players it skipped, so the next change to it can be chosen from these.
  console.info(
    JSON.stringify({ at: "home_panel", panel: "latest_parts", parts: perf }),
  );
  return {
    items: newest.map((it) => ({
      id: it.id ?? null,
      at: shownAt(it) || null,
      text: String(it.text ?? ""),
    })),
  };
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

export function homeRoutes({ resolveAccount, exploreRegistry, clan }) {
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
      const clanPanel = await panel("clan", () =>
        readClanPanel({
          db,
          account,
          event,
          read,
          clan,
          requestId: context?.requestId ?? null,
        }),
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
      const week = await panel("week", () =>
        readWeek(read, db, tag, event.queryStringParameters?.mode ?? null),
      );
      return json(200, { week });
    },

    "GET /api/me/home/latest": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (!(await panelRate(db, account)))
        return json(429, { error: "rate_limited" });
      const latest = await panel("latest", () => readLatest(db, account));
      return json(200, { latest });
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
