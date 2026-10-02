/** The public battle page (Jamie, 2026-10-01: "Public yes."): one recorded
 *  battle, sign-in free, at /battle/<short id>. Its JSON, the page's
 *  preview tags and its share image all read this one projection, so the
 *  three never disagree.
 *
 *  The battle comes from battles_query's own handler, the same reading
 *  the agents and the console get, projected down to what the page shows.
 *  It runs as no account at all: no nickname, no quota, no read stamp, no
 *  audit row - a page view is not a tool call and must not move the
 *  scheduler. "Left is the player right is opponent" (Jamie): the left is
 *  the side whose log the record read first, always a recorded player.
 *  Game names only; nicknames are account data and never appear here. */
import { battles_query } from "@elixir-mcp/tools/tools/battles/query";
import { isDuel } from "@elixir-mcp/tools/tools/battles/common";
import { battleLinks, resolveBattleRef } from "@elixir-mcp/record/battle-links";
import { DISCLAIMER, modeGroupOf } from "@elixir-mcp/contracts";

/** No account: the handler reads the window's zone from it, nothing else
 *  (a battle_id read never resolves a subject). */
const NO_ACCOUNT = Object.freeze({ id: null, kind: "public", timezone: "UTC" });

/** A sitting breaks on a 30-minute gap, as the timeline's sessions do. */
const SITTING_GAP_MS = 30 * 60_000;
const SITTING_SPAN_MS = 4 * 3600_000;
const SITTING_MAX = 12;
const MEETINGS_MAX = 6;

/** A crowd of costs, one read: the catalog's current elixir_cost. */
async function costsOf(db, ids) {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query(
    `select card_id, elixir_cost from card where card_id = any($1::int[])`,
    [[...new Set(ids)]],
  );
  return new Map(rows.map((r) => [r.card_id, r.elixir_cost]));
}

/** The four cheapest cards: what it costs to cycle back to a card. Null
 *  when a cost is missing (Mirror has none) - never a guess. */
export function cycle4(cards, costs) {
  const c = cards.map((x) => costs.get(x.id));
  if (c.length < 4 || c.some((v) => typeof v !== "number")) return null;
  return [...c]
    .sort((a, b) => a - b)
    .slice(0, 4)
    .reduce((a, v) => a + v, 0);
}

const mean = (xs) =>
  xs.length
    ? Math.round((xs.reduce((a, v) => a + v, 0) / xs.length) * 100) / 100
    : null;

function deckOf(cards, archetype, tower, costs) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const levels = cards.map((c) => c.level).filter((l) => typeof l === "number");
  return {
    cards: cards.map((c) => ({
      id: c.id,
      name: c.name,
      form: c.form ?? "base",
      level: c.level ?? null,
    })),
    tower_troop: tower
      ? { id: tower.id, name: tower.name, level: tower.level ?? null }
      : null,
    label: archetype?.label ?? null,
    average_elixir: archetype?.average_elixir ?? null,
    cycle4: cycle4(cards, costs),
    average_level: mean(levels),
  };
}

function playerOf(p, costs) {
  const d = p.deck ?? null;
  const rounds = Array.isArray(d?.rounds)
    ? d.rounds.map((r) => deckOf(r.cards, r.archetype, null, costs))
    : null;
  return {
    player_tag: p.player_tag,
    name: p.name ?? null,
    clan_tag: p.clan_tag ?? null,
    clan_name: p.clan_name ?? null,
    starting_trophies: p.starting_trophies ?? null,
    trophy_change: p.trophy_change ?? null,
    global_rank: p.global_rank ?? null,
    elixir_leaked: p.elixir?.leaked ?? null,
    deck: rounds
      ? null
      : deckOf(d?.cards, d?.archetype, d?.supportCards?.[0], costs),
    rounds,
  };
}

const flip = (o) => (o === "win" ? "loss" : o === "loss" ? "win" : o);

/** Which game of a duel each side took: more crowns, else the game's
 *  tiebreaker (the side whose weakest tower stood higher). */
function roundWinner(a, b) {
  if (a.crowns !== b.crowns) return a.crowns > b.crowns ? 0 : 1;
  const low = (t) =>
    t
      ? Math.min(
          t.king ?? Infinity,
          ...(t.princess ?? []).map((x) => x ?? Infinity),
        )
      : null;
  const la = low(a.tower_hp);
  const lb = low(b.tower_hp);
  if (la === null || lb === null || la === lb) return null;
  return la > lb ? 0 : 1;
}

/** The battle a reference names, projected for the page. `{status: 404}`
 *  when nothing matches; `{status: 300, matches}` when a hand-cut prefix
 *  names several (a link Elixir hands out never does). */
export async function readPublicBattle(db, ref) {
  const ids = await resolveBattleRef(db, ref);
  if (ids.length === 0) return { status: 404 };
  if (ids.length > 1) {
    const links = await battleLinks(db, ids);
    return { status: 300, matches: ids.map((id) => links.get(id)?.url) };
  }
  const body = await battles_query.handler(
    { db, account: NO_ACCOUNT, live: null },
    { battle_id: ids[0], verbosity: "full", timezone: "UTC" },
  );
  const rows = body?.battles ?? [];
  if (rows.length === 0) return { status: 404 };
  const b = rows[0];
  // A battle by id names its own side (me.player_tag, me.name). In a 2v2
  // the first row's teammates are the rest of the team.
  const leftPlayers = [b.me, ...(b.teammates ?? [])];
  const rightPlayers = b.opponents ?? [];
  const allCards = [...leftPlayers, ...rightPlayers].flatMap((p) => [
    ...(p.deck?.cards ?? []),
    ...(p.deck?.rounds ?? []).flatMap((r) => r.cards ?? []),
  ]);
  const costs = await costsOf(
    db,
    allCards.map((c) => c.id),
  );
  const duel = leftPlayers.some((p) => Array.isArray(p.deck?.rounds));
  const kind = duel
    ? "duel"
    : b.type?.startsWith("boatBattle")
      ? "boat"
      : leftPlayers.length > 1
        ? "2v2"
        : "1v1";
  const opp = rightPlayers[0] ?? null;
  const left = {
    outcome: b.me.outcome ?? null,
    crowns: b.me.crowns ?? null,
    tower_hp: b.me.tower_hp ?? null,
    players: leftPlayers.map((p) => playerOf(p, costs)),
  };
  const right = {
    outcome: flip(b.me.outcome ?? null),
    crowns: opp?.crowns ?? null,
    tower_hp: opp?.tower_hp ?? null,
    players: rightPlayers.map((p) => playerOf(p, costs)),
  };
  // A duel game by game, from both sides' own rounds[].
  let games = null;
  if (duel && Array.isArray(b.me.rounds) && b.me.rounds.length) {
    games = b.me.rounds.map((r) => {
      const o = opp?.rounds?.find((x) => x.round === r.round) ?? null;
      const a = {
        crowns: r.crowns,
        tower_hp: r.tower_hp ?? null,
        elixir_leaked: r.elixir?.leaked ?? null,
      };
      const z = o
        ? {
            crowns: o.crowns,
            tower_hp: o.tower_hp ?? null,
            elixir_leaked: o.elixir?.leaked ?? null,
          }
        : null;
      const w = z ? roundWinner(a, z) : null;
      return {
        round: r.round,
        winner: w === null ? null : w === 0 ? "left" : "right",
        sides: [a, z],
      };
    });
  }
  const links = await battleLinks(db, [b.battle_id]);
  const link = links.get(b.battle_id);
  const leftTag = left.players[0]?.player_tag ?? null;
  const rightTag = right.players[0]?.player_tag ?? null;
  // One pg client: the two reads go one after the other.
  const solo = kind !== "2v2" && leftTag;
  const meetings =
    solo && rightTag ? await meetingsOf(db, leftTag, rightTag) : [];
  const sitting = solo ? await sittingOf(db, leftTag, b.battle_time) : [];
  return {
    status: 200,
    battle: {
      id: b.battle_id,
      short_id: link?.short_id ?? null,
      url: link?.url ?? null,
      // The share picture (/battle/<short id>.png) is not drawn yet.
      image: null,
      battle_time: b.battle_time,
      type: b.type,
      kind,
      mode_group: b.mode_group ?? null,
      game_mode: b.game_mode ?? null,
      arena: b.arena ?? null,
      duration: b.inferred?.duration ?? null,
      deck_level_edge: b.me.vs?.deck_level ?? null,
    },
    sides: [left, right],
    games,
    meetings,
    sitting,
    disclaimer: DISCLAIMER,
  };
}

/** Every recorded 1v1 between the two, newest first. */
async function meetingsOf(db, a, z) {
  const { rows } = await db.query(
    `select b.battle_id, b.battle_time, b.type, b.event_tag,
            bp.crowns, o.crowns as crowns_against, bp.outcome
       from battle_participant bp
       join battle_participant o
         on o.battle_id = bp.battle_id and o.side <> bp.side and o.player_tag = $2
       join battle b on b.battle_id = bp.battle_id
      where bp.player_tag = $1
      order by bp.battle_time desc, bp.battle_id desc
      limit ${MEETINGS_MAX}`,
    [a, z],
  );
  return linked(db, rows, (r) => ({
    crowns: r.crowns,
    crowns_against: r.crowns_against,
    outcome: r.outcome,
  }));
}

/** The left player's sitting around this battle: their battles chained
 *  by gaps under 30 minutes, newest first, at most a dozen. */
async function sittingOf(db, tag, at) {
  const t = Date.parse(at);
  const { rows } = await db.query(
    `select b.battle_id, b.battle_time, b.type, b.event_tag,
            bp.crowns, bp.outcome,
            (select o.crowns from battle_participant o
              where o.battle_id = bp.battle_id and o.side <> bp.side
              order by o.player_tag limit 1) as crowns_against,
            (select coalesce(p.name, o.player_tag) from battle_participant o
               left join player p on p.player_tag = o.player_tag
              where o.battle_id = bp.battle_id and o.side <> bp.side
              order by o.player_tag limit 1) as opponent
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.player_tag = $1
        and bp.battle_time between $2 and $3
      order by bp.battle_time`,
    [tag, new Date(t - SITTING_SPAN_MS), new Date(t + SITTING_SPAN_MS)],
  );
  const i = rows.findIndex((r) => Date.parse(r.battle_time) === t);
  if (i < 0) return [];
  let lo = i;
  let hi = i;
  const gap = (x, y) =>
    Date.parse(rows[y].battle_time) - Date.parse(rows[x].battle_time);
  while (lo > 0 && gap(lo - 1, lo) < SITTING_GAP_MS) lo -= 1;
  while (hi < rows.length - 1 && gap(hi, hi + 1) < SITTING_GAP_MS) hi += 1;
  const run = rows
    .slice(lo, hi + 1)
    .reverse()
    .slice(0, SITTING_MAX);
  return linked(db, run, (r) => ({
    opponent: r.opponent,
    crowns: r.crowns,
    crowns_against: r.crowns_against,
    outcome: r.outcome,
  }));
}

async function linked(db, rows, pick) {
  const links = await battleLinks(
    db,
    rows.map((r) => r.battle_id),
  );
  return rows.map((r) => ({
    url: links.get(r.battle_id)?.url ?? null,
    battle_time: new Date(r.battle_time).toISOString(),
    mode_group: modeGroupOf(r.type, r.event_tag),
    // A duel's crowns are summed over its games: the page says the
    // result rather than a score the duel never had.
    duel: isDuel(r.type),
    ...pick(r),
  }));
}
