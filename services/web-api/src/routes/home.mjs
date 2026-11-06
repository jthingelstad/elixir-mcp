import { checkRateLimit } from "@elixir-mcp/auth";
import { featuredDeck, buildFriendsWeek } from "@elixir-mcp/tools/friends-week";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { gameWeekStartMs } from "@elixir-mcp/record/form";
import { lastGameWeek } from "@elixir-mcp/record/game-week";

import { json } from "../http.mjs";
import { toolDeadlineMs } from "../deadline.mjs";
import { firstAnswer } from "../first-answer.mjs";
import { myClans } from "./clans.mjs";

/** Home's reads (redesign step 3a): one request where the page would make
 *  about seven, so a visit spends one charge on the person's hourly bucket.
 *  The app's own internal API, not a JSON API version. Reads run one after
 *  another (one client, one query at a time), and each panel answers for
 *  itself: a failed one says `{ ok: false }` and the rest still render. */

const LATEST = 5;
/** Below about this many battles a "most played" deck says little (the
 *  board's rule). */
const DECK_FROM = 5;
const LEADERS = new Set(["leader", "coLeader"]);
/** The modes a week's chips can name, the ones Ladder names plus Casual. */
const WEEK_MODES = ["ladder", "ranked", "war", "casual", "event"];

/** One panel's read: its answer, or that it could not be read. */
export async function panel(name, read) {
  try {
    return { ok: true, ...(await read()) };
  } catch (err) {
    console.error(
      JSON.stringify({
        at: "home_panel_failed",
        panel: name,
        code: err?.code ?? null,
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

/** Your week since Monday's reset, in one mode: modes are different games
 *  and nothing here pools them. */
export async function readWeek(read, tag, wanted, now = Date.now()) {
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
    const one = await read("battles_performance", {
      player_tag: tag,
      ...window,
      mode,
    });
    out.net_trophies = one?.window?.net_trophies ?? null;
  }
  if (mode === "ladder") {
    const summary = await read("players_summary", { player_tag: tag });
    out.trophies = summary?.trophies ?? null;
  }
  if (battles >= DECK_FROM) {
    const list = await read("battles_decks", {
      player_tag: tag,
      ...window,
      mode,
      limit: 1,
    });
    const top = list?.decks?.[0];
    if (top) {
      const full = await read("battles_decks", {
        player_tag: tag,
        ...window,
        mode,
        deck_hash: top.deck_hash,
      });
      out.deck = featuredDeck(top, full?.decks?.[0]);
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
async function readClanView(clan, { db, account, event, clanTag, requestId }) {
  const res = await clan({
    db,
    account,
    requestId,
    event: {
      ...event,
      method: "GET",
      path: `/api/clan/clans/${clanTag.replace(/^#/, "")}/home`,
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

async function readClanPanel({ db, account, event, read, clan, requestId }) {
  const clans = await myClans(db, account);
  const home = clans.home_clan;
  if (!home) return { state: "none" };
  const tracked = clans.clans.find((c) => c.clan_tag === home.clan_tag);
  if (!tracked)
    return {
      state: "untracked",
      clan_tag: home.clan_tag,
      name: home.name ?? null,
      slots: clans.slots.activity,
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
      name: home.name ?? tracked.name ?? null,
      last_race: lastRace,
      needs: [],
      needs_total: 0,
    };
  return {
    state: "member",
    ...shapeClan({ name: home.name, ...view }, { lastRace }),
  };
}

async function readLatest(db, account) {
  const now = Date.now();
  const subjects = await subjectsFor(db, account.accountId);
  const built = await buildTimeline(db, subjects, {
    fromMs: now - 7 * 86_400_000,
    toMs: now,
    timezone: account.timezone ?? "UTC",
    accountId: account.accountId,
    interactive: true,
  });
  return {
    items: (built.timeline ?? []).slice(0, LATEST).map((it) => ({
      id: it.id ?? null,
      at: it.at ?? null,
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

const person = (p) => ({
  tag: p.tag,
  name: p.name,
  nickname: p.nickname ?? null,
  clan_tag: p.clan?.tag ?? null,
  battles: p.battles ?? 0,
  wins: p.wins ?? 0,
  losses: p.losses ?? 0,
  by_family: p.by_family ?? [],
  moments: p.moments ?? [],
  deck: p.deck ?? null,
  line: p.line ?? null,
});

export function homeRoutes({ resolveAccount, exploreRegistry, clan }) {
  return {
    "GET /api/me/home": async (db, event, _body, context) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (!(await rate(db, account)))
        return json(429, { error: "rate_limited" });
      const first = await panel("first_answer", () =>
        firstAnswer(db, account.accountId),
      );
      const tag = first.ok ? first.player?.player_tag : null;
      if (!tag) return json(200, { first });
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
      const week = await panel("week", () =>
        readWeek(read, tag, event.queryStringParameters?.mode ?? null),
      );
      const latest = await panel("latest", () => readLatest(db, account));
      return json(200, { first, clan: clanPanel, week, latest });
    },

    // A chip on Your week: that panel alone, the rest stay as they are.
    "GET /api/me/home/week": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      if (!(await rate(db, account)))
        return json(429, { error: "rate_limited" });
      const first = await firstAnswer(db, account.accountId);
      const tag = first.player?.player_tag;
      if (!tag) return json(404, { error: "no_player" });
      const read = toolReader(db, account, exploreRegistry(), event);
      const week = await panel("week", () =>
        readWeek(read, tag, event.queryStringParameters?.mode ?? null),
      );
      return json(200, { week });
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
      const facts = await buildFriendsWeek({
        db,
        account: { ...account, timezone: account.timezone ?? "UTC" },
        week,
        season: week.season,
        callTool: (ctx, name, args) => registry.invoke(name, ctx, args),
        within: () => Date.now() < stopAt,
      });
      // Whose card opens their Clan member page rather than the record.
      const { home_clan: home } = await myClans(db, account);
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
